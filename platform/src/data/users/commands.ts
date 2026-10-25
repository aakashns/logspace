// Signing up, and deleting accounts, the write side of the `users`, `verifications`, and
// `rate_limits` tables: someone asks for a code (passing Turnstile, and as often as an address may
// be sent one), which is emailed to them, and entering it makes their account and emails them that
// they're subscribed. Only an account's address is proven, so an address that already has one
// gets the same pages and emails, and the form never says who has an account.
import { randomInt, timingSafeEqual } from 'node:crypto'
import { Clock, Context, DateTime, Effect, Layer, Option, Schema, Semaphore } from 'effect'
import { SqlClient } from 'effect/sql'

import { Email, type EmailFailure } from '../site/email.ts'
import { SiteConfigQueries } from '../site/queries.ts'
import { subscriptionsStatus } from '../site/subscriptions.ts'
import { Turnstile, type TurnstileFailure } from '../site/turnstile.ts'
import {
  checkSignUp,
  hashCode,
  PendingSignUp,
  SIGN_UP_CODE_ATTEMPTS,
  SIGN_UP_CODE_GAP_SECONDS,
  SIGN_UP_CODE_LENGTH,
  SIGN_UP_CODE_MINUTES,
  SIGN_UP_CODES_PER_HOUR,
  type SignUpForm,
  signUpEmail,
  signUpIdentifier,
  signUpRateLimitKey,
  typedCode,
} from './user.ts'

// Subscribing is off, or paused (see ../site/subscriptions.ts).
export class SubscriptionsClosed extends Schema.TaggedError<SubscriptionsClosed>()(
  'SubscriptionsClosed',
  {},
) {}

// The form wasn't sent on, for these reasons.
export class SignUpRejected extends Schema.TaggedError<SignUpRejected>()('SignUpRejected', {
  issues: Schema.Array(
    Schema.Struct({ field: Schema.Literals(['name', 'email']), message: Schema.String }),
  ),
}) {}

// Too many codes were sent to the address lately: one `just` now, or the most an hour allows.
// Another can be sent in `retryAfter` seconds.
export class SignUpRateLimited extends Schema.TaggedError<SignUpRateLimited>()(
  'SignUpRateLimited',
  { reason: Schema.Literals(['just', 'hourly']), retryAfter: Schema.Int },
) {}

// The code isn't the one sent. With no attempts left, it's used up, and a new one is needed.
export class SignUpCodeWrong extends Schema.TaggedError<SignUpCodeWrong>()('SignUpCodeWrong', {
  attemptsLeft: Schema.Int,
}) {}

// There's no code with that id waiting: it expired, or was used up.
export class SignUpCodeExpired extends Schema.TaggedError<SignUpCodeExpired>()(
  'SignUpCodeExpired',
  {},
) {}

const decodePending = Schema.decodeUnknownOption(Schema.fromJsonString(PendingSignUp))
const HOUR = 60 * 60 * 1000

export class UserCommands extends Context.Service<
  UserCommands,
  {
    // Checks the form, Turnstile's token, and how many codes the address was sent lately, then
    // emails it a code. Returns the id of the code's row, which the page to enter it is at.
    readonly requestSignUp: (
      form: SignUpForm,
      turnstileToken: string,
    ) => Effect.Effect<
      string,
      SubscriptionsClosed | SignUpRejected | TurnstileFailure | SignUpRateLimited | EmailFailure
    >
    // Makes the account for the address the code with that id was sent to, if `code` is it, and
    // emails them that they're subscribed. Returns who signed up.
    readonly completeSignUp: (
      id: string,
      code: string,
    ) => Effect.Effect<
      { name: string; email: string },
      SubscriptionsClosed | SignUpCodeWrong | SignUpCodeExpired
    >
    // Deletes someone's account, so they're no longer subscribed. One already gone stays gone.
    readonly delete: (id: string) => Effect.Effect<void>
  }
>()('logspace/UserCommands') {
  static readonly layer = Layer.effect(
    UserCommands,
    Effect.gen(function* () {
      let sql = yield* SqlClient.SqlClient
      let queries = yield* SiteConfigQueries
      let email = yield* Email
      let turnstile = yield* Turnstile
      let services = Context.make(SiteConfigQueries, queries).pipe(
        Context.add(Email, email),
        Context.add(Turnstile, turnstile),
      )
      // Counting codes sent and wrong codes, and using a right one, happen one at a time.
      let codes = yield* Semaphore.make(1)
      // The time, from the clock the app was made with (which the tests control).
      let clock = yield* Clock.Clock
      let currentTime = DateTime.now.pipe(Effect.provideService(Clock.Clock, clock))

      let requireOpen = Effect.flatMap(
        Effect.provideContext(subscriptionsStatus, services),
        (status) => (status._tag === 'Open' ? Effect.void : Effect.fail(new SubscriptionsClosed())),
      )
      let site = Effect.map(queries.saved, (saved) => ({
        title: saved.siteTitle ?? '',
        url: saved.siteUrl ?? '',
      }))

      // Counts a code to be sent to the address, as better-auth's rate limiter counts requests,
      // or says why it can't be sent yet. The count goes once its last code is an hour old.
      let countCode = (address: string, now: number) =>
        Effect.gen(function* () {
          let key = signUpRateLimitKey(address)
          yield* sql`delete from rate_limits where last_request <= ${now - HOUR}`
          let [row] = yield* sql<{ count: number; last_request: number }>`
            select count, last_request from rate_limits where key = ${key}`
          let since = row ? now - row.last_request : HOUR
          let gap = SIGN_UP_CODE_GAP_SECONDS * 1000
          if (since < gap) {
            let retryAfter = Math.ceil((gap - since) / 1000)
            return new SignUpRateLimited({ reason: 'just', retryAfter })
          }
          if (row && row.count >= SIGN_UP_CODES_PER_HOUR) {
            let retryAfter = Math.ceil((HOUR - since) / 1000)
            return new SignUpRateLimited({ reason: 'hourly', retryAfter })
          }
          yield* sql`insert into rate_limits ${sql.insert({ key, count: 1, last_request: now })}
            on conflict (key) do update set count = count + 1, last_request = ${now}`
          return undefined
        }).pipe(sql.withTransaction, Effect.orDie)

      let requestSignUp = Effect.fn('UserCommands.requestSignUp')(function* (
        form: SignUpForm,
        turnstileToken: string,
      ) {
        yield* requireOpen
        let checked = checkSignUp(form)
        if (checked._tag === 'Failure') {
          return yield* new SignUpRejected({ issues: checked.failure })
        }
        let { name, email: address } = checked.success
        yield* turnstile.verify(turnstileToken)
        let now = yield* currentTime
        let limited = yield* codes.withPermit(countCode(address, DateTime.toEpochMillis(now)))
        if (limited) return yield* limited
        let code = String(randomInt(10 ** SIGN_UP_CODE_LENGTH)).padStart(SIGN_UP_CODE_LENGTH, '0')
        let { title } = yield* site
        yield* email.send({
          to: address,
          subject: `${code} is your code to subscribe to ${title}`,
          text:
            `Hi ${name},\n\nEnter this code to finish subscribing to ${title}:\n\n${code}\n\n` +
            `It expires in ${SIGN_UP_CODE_MINUTES} minutes. If you didn’t ask to subscribe, ` +
            'ignore this email.\n',
        })
        // Saved once it's sent. Each code is entered at its own page, so the codes sent before
        // stay as they are (until they expire), and no one else asking for a code for the address
        // can replace or use up someone's.
        let value: PendingSignUp = { code: hashCode(code), name, attempts: 0 }
        let id = crypto.randomUUID()
        let sent = yield* currentTime
        yield* Effect.gen(function* () {
          yield* sql`delete from verifications where expires_at <= ${DateTime.formatIso(sent)}`
          yield* sql`insert into verifications ${sql.insert({
            id,
            identifier: signUpIdentifier(address),
            value: JSON.stringify(value),
            expires_at: DateTime.formatIso(DateTime.add(sent, { minutes: SIGN_UP_CODE_MINUTES })),
            created_at: DateTime.formatIso(sent),
            updated_at: DateTime.formatIso(sent),
          })}`
        }).pipe(sql.withTransaction, Effect.orDie)
        return id
      })

      // What a code typed for the code with that id comes to: who signed up, or why not. Nothing
      // fails in the transaction, so a wrong code's count is kept.
      let useCode = (id: string, typed: string, now: DateTime.Utc) =>
        Effect.gen(function* () {
          let [row] = yield* sql<{
            id: string
            identifier: string
            value: string
            expires_at: string
          }>`
            select id, identifier, value, expires_at from verifications where id = ${id}`
          let pending = row ? Option.getOrUndefined(decodePending(row.value)) : undefined
          let address = row && signUpEmail(row.identifier)
          if (!row || !pending || !address || row.expires_at <= DateTime.formatIso(now)) {
            if (row) yield* sql`delete from verifications where id = ${row.id}`
            return new SignUpCodeExpired()
          }
          let given = Buffer.from(hashCode(typed))
          let expected = Buffer.from(pending.code)
          if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
            let attempts = pending.attempts + 1
            if (attempts >= SIGN_UP_CODE_ATTEMPTS) {
              yield* sql`delete from verifications where id = ${row.id}`
            } else {
              yield* sql`update verifications set ${sql.update({
                value: JSON.stringify({ ...pending, attempts }),
                updated_at: DateTime.formatIso(now),
              })} where id = ${row.id}`
            }
            return new SignUpCodeWrong({
              attemptsLeft: Math.max(0, SIGN_UP_CODE_ATTEMPTS - attempts),
            })
          }
          yield* sql`delete from verifications where identifier = ${signUpIdentifier(address)}`
          // An address that has an account keeps it as it is.
          yield* sql`insert into users ${sql.insert({
            id: crypto.randomUUID(),
            name: pending.name,
            email: address,
            email_verified: 1,
            created_at: DateTime.formatIso(now),
            updated_at: DateTime.formatIso(now),
          })} on conflict (email) do nothing`
          return { name: pending.name, email: address }
        }).pipe(sql.withTransaction, Effect.orDie)

      let completeSignUp = Effect.fn('UserCommands.completeSignUp')(function* (
        id: string,
        code: string,
      ) {
        yield* requireOpen
        let outcome = yield* codes.withPermit(useCode(id, typedCode(code), yield* currentTime))
        if (outcome instanceof SignUpCodeWrong || outcome instanceof SignUpCodeExpired) {
          return yield* outcome
        }
        let { title, url } = yield* site
        // They're subscribed whether or not this arrives.
        yield* email
          .send({
            to: outcome.email,
            subject: `You’re subscribed to ${title}`,
            text: `Hi ${outcome.name},\n\nYou’re now subscribed to ${title} (${url}), as ${outcome.email}.\n`,
          })
          .pipe(Effect.ignore)
        return outcome
      })

      let remove = Effect.fn('UserCommands.delete')(function* (id: string) {
        yield* sql`delete from users where id = ${id}`.pipe(Effect.orDie)
      })

      return UserCommands.of({ requestSignUp, completeSignUp, delete: remove })
    }),
  )
}
