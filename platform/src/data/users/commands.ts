// Signing up, the write side of the `users` and `verifications` tables: someone asks for a code
// (passing Turnstile), which is emailed to them, and entering it makes their account and emails
// them that they're subscribed. Only an account's address is proven, so an address that already
// has one gets the same pages and emails, and the form never says who has an account.
import { randomInt, timingSafeEqual } from 'node:crypto'
import { Context, DateTime, Effect, Layer, Option, Schema, Semaphore } from 'effect'
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
  SIGN_UP_CODE_LENGTH,
  SIGN_UP_CODE_MINUTES,
  type SignUpForm,
  signUpEmail,
  signUpIdentifier,
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

// The code isn't the one sent. With no attempts left, it's used up, and a new one is needed.
export class SignUpCodeWrong extends Schema.TaggedError<SignUpCodeWrong>()('SignUpCodeWrong', {
  attemptsLeft: Schema.Int,
}) {}

// There's no code waiting: it expired, was used up, or was replaced by a newer one.
export class SignUpCodeExpired extends Schema.TaggedError<SignUpCodeExpired>()(
  'SignUpCodeExpired',
  {},
) {}

const decodePending = Schema.decodeUnknownOption(Schema.fromJsonString(PendingSignUp))

export class UserCommands extends Context.Service<
  UserCommands,
  {
    // Checks the form and Turnstile's token, then emails a code to the address, replacing any it
    // was sent before. Returns the id of the code's row, which only the browser that asked is
    // given, to say which code it's entering.
    readonly requestSignUp: (
      form: SignUpForm,
      turnstileToken: string,
    ) => Effect.Effect<
      string,
      SubscriptionsClosed | SignUpRejected | TurnstileFailure | EmailFailure
    >
    // Makes the account for the code with that id, if `code` is the one emailed, and emails them
    // that they're subscribed. Returns who signed up.
    readonly completeSignUp: (
      id: string,
      code: string,
    ) => Effect.Effect<
      { name: string; email: string },
      SubscriptionsClosed | SignUpCodeWrong | SignUpCodeExpired
    >
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
      // Counting a wrong code, and using a right one, happen one at a time.
      let codes = yield* Semaphore.make(1)

      let requireOpen = Effect.flatMap(
        Effect.provideContext(subscriptionsStatus, services),
        (status) => (status._tag === 'Open' ? Effect.void : Effect.fail(new SubscriptionsClosed())),
      )
      let site = Effect.map(queries.saved, (saved) => ({
        title: saved.siteTitle ?? '',
        url: saved.siteUrl ?? '',
      }))

      let requestSignUp = Effect.fn('UserCommands.requestSignUp')(function* (
        form: SignUpForm,
        turnstileToken: string,
      ) {
        yield* requireOpen
        let checked = checkSignUp(form)
        if (checked._tag === 'Failure')
          return yield* new SignUpRejected({ issues: checked.failure })
        let { name, email: address } = checked.success
        yield* turnstile.verify(turnstileToken)
        let code = String(randomInt(10 ** SIGN_UP_CODE_LENGTH)).padStart(SIGN_UP_CODE_LENGTH, '0')
        let now = yield* DateTime.now
        let identifier = signUpIdentifier(address)
        let value: PendingSignUp = { code: hashCode(code), name, attempts: 0 }
        let id = crypto.randomUUID()
        yield* Effect.gen(function* () {
          yield* sql`delete from verifications where identifier = ${identifier}
            or expires_at <= ${DateTime.formatIso(now)}`
          yield* sql`insert into verifications ${sql.insert({
            id,
            identifier,
            value: JSON.stringify(value),
            expires_at: DateTime.formatIso(DateTime.add(now, { minutes: SIGN_UP_CODE_MINUTES })),
            created_at: DateTime.formatIso(now),
            updated_at: DateTime.formatIso(now),
          })}`
        }).pipe(sql.withTransaction, Effect.orDie)
        let { title } = yield* site
        yield* email.send({
          to: address,
          subject: `${code} is your code to subscribe to ${title}`,
          text:
            `Hi ${name},\n\nEnter this code to finish subscribing to ${title}:\n\n${code}\n\n` +
            `It expires in ${SIGN_UP_CODE_MINUTES} minutes. If you didn’t ask to subscribe, ` +
            'ignore this email.\n',
        })
        return id
      })

      // What a code typed comes to: who it was sent to, or why not. Nothing fails in the
      // transaction, so a wrong code's count is kept.
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
          yield* sql`delete from verifications where id = ${row.id}`
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
        let outcome = yield* codes.withPermit(useCode(id, typedCode(code), yield* DateTime.now))
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

      return UserCommands.of({ requestSignUp, completeSignUp })
    }),
  )
}
