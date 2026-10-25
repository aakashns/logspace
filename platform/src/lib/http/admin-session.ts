// /admin is protected by one admin password, ADMIN_PASSWORD. Logging in stores a fingerprint of
// it in a session cookie signed with AUTH_SESSION_SECRET, so changing the password logs out every
// browser, and so does changing the secret, since old cookies no longer verify. /admin stays
// switched off until both are set and at least 16 characters.
//
// A session also needs an unexpired SQLite row, removed on logout. The cookie is base64url JSON,
// a dot, and its HMAC-SHA256 signature. It's
// HttpOnly, SameSite=Lax, Secure in production, and sent only to /admin, so public pages never
// receive it. Beside it, a logged-in browser gets a cookie that only says so (ADMIN_HINT_COOKIE),
// sent to every page, so they can show the navbar's link to the composer. It proves nothing: a
// made-up one just shows a link that leads to the login page.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { Clock, Context, Effect, Layer, Option, Redacted, Schema } from 'effect'
import { HttpServerRequest, HttpServerResponse } from 'effect/http'
import { SqlClient } from 'effect/sql'

import { AppConfig } from '../config.ts'

const COOKIE_NAME = 'admin_session'
export const ADMIN_HINT_COOKIE = 'admin'
const MAX_AGE = 60 * 60 * 24 * 30
const MIN_SECRET_LENGTH = 16
const MAX_SESSIONS = 100

export const AdminSession = Schema.Struct({
  // A new id on login guards against session fixation.
  id: Schema.String,
  // The password's fingerprint, once logged in.
  auth: Schema.optionalKey(Schema.String),
  // A note for the next page, like "the settings were saved", which reading clears.
  flash: Schema.optionalKey(Schema.String),
})
export type AdminSession = typeof AdminSession.Type

// The cookie's payload, base64url JSON.
const decodePayload = Schema.decodeUnknownOption(Schema.fromJsonString(AdminSession))

// Someone who isn't logged in as admin asked for an admin page.
export class NotLoggedInAsAdmin extends Schema.TaggedError<NotLoggedInAsAdmin>()(
  'NotLoggedInAsAdmin',
  {},
) {}

export class AdminAuth extends Context.Service<
  AdminAuth,
  {
    readonly enabled: boolean
    // The request's session, or a new empty one.
    readonly session: Effect.Effect<AdminSession, never, HttpServerRequest.HttpServerRequest>
    // The request's session if it's logged in as admin.
    readonly requireLogin: Effect.Effect<
      AdminSession,
      NotLoggedInAsAdmin,
      HttpServerRequest.HttpServerRequest
    >
    // A new logged-in session.
    readonly logIn: (input: unknown) => Effect.Effect<AdminSession | undefined>
    readonly logOut: Effect.Effect<void, never, HttpServerRequest.HttpServerRequest>
    // Sets the session's cookie on a response, or with undefined, clears it. The hint cookie is
    // set while it's logged in, and cleared with it.
    readonly saveSession: (
      response: HttpServerResponse.HttpServerResponse,
      session: AdminSession | undefined,
    ) => HttpServerResponse.HttpServerResponse
  }
>()('logspace/AdminAuth') {
  static readonly layer = Layer.effect(
    AdminAuth,
    Effect.gen(function* () {
      let config = yield* AppConfig
      let sql = yield* SqlClient.SqlClient
      let clock = yield* Clock.Clock
      let password = Redacted.value(config.adminPassword)
      let secret = Redacted.value(config.sessionSecret)
      let enabled = password.length >= MIN_SECRET_LENGTH && secret.length >= MIN_SECRET_LENGTH
      let fingerprint = createHmac('sha256', secret).update(password).digest('base64url')
      let sign = (payload: string) => createHmac('sha256', secret).update(payload).digest()

      let read = (cookie: string | undefined): AdminSession | undefined => {
        if (!enabled || !cookie) return undefined
        let [payload, signature, extra] = cookie.split('.')
        if (!payload || !signature || extra !== undefined) return undefined
        let expected = sign(payload)
        let given = Buffer.from(signature, 'base64url')
        if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined
        return Option.getOrUndefined(
          decodePayload(Buffer.from(payload, 'base64url').toString('utf8')),
        )
      }

      let session = Effect.gen(function* () {
        let request = yield* HttpServerRequest.HttpServerRequest
        let decoded = read(request.cookies[COOKIE_NAME])
        if (decoded?.auth === fingerprint) {
          let now = clock.currentTimeMillisUnsafe()
          let rows = yield* sql`select 1 from admin_sessions where id = ${decoded.id}
            and auth = ${fingerprint} and expires_at > ${now}`.pipe(Effect.orDie)
          if (rows.length > 0) return decoded
        }
        return AdminSession.make({ id: crypto.randomUUID() })
      })

      let logIn = Effect.fn('AdminAuth.logIn')(function* (input: unknown) {
        if (!enabled || typeof input !== 'string') return undefined
        let hash = (value: string) => createHash('sha256').update(value).digest()
        if (!timingSafeEqual(hash(input), hash(password))) return undefined
        let now = clock.currentTimeMillisUnsafe()
        let loggedIn = { id: crypto.randomUUID(), auth: fingerprint }
        yield* Effect.gen(function* () {
          yield* sql`delete from admin_sessions where expires_at <= ${now} or auth != ${fingerprint}`
          yield* sql`delete from admin_sessions where id not in
            (select id from admin_sessions order by expires_at desc, id limit ${MAX_SESSIONS - 1})`
          yield* sql`insert into admin_sessions ${sql.insert({
            ...loggedIn,
            expires_at: now + MAX_AGE * 1000,
          })}`
        }).pipe(sql.withTransaction, Effect.orDie)
        return loggedIn
      })

      return AdminAuth.of({
        enabled,
        session,
        requireLogin: Effect.flatMap(session, (session) =>
          enabled && session.auth === fingerprint
            ? Effect.succeed(session)
            : Effect.fail(new NotLoggedInAsAdmin()),
        ),
        logIn,
        logOut: Effect.flatMap(session, (current) =>
          sql`delete from admin_sessions where id = ${current.id}`.pipe(
            Effect.orDie,
            Effect.asVoid,
          ),
        ),
        saveSession: (response, session) => {
          let options = {
            httpOnly: true,
            sameSite: 'lax' as const,
            path: '/admin',
            // Plain HTTP in development; production is only served over HTTPS.
            secure: config.mode === 'production',
          }
          let hint = { ...options, path: '/' }
          if (!session) {
            return HttpServerResponse.expireCookieUnsafe(
              HttpServerResponse.expireCookieUnsafe(response, COOKIE_NAME, options),
              ADMIN_HINT_COOKIE,
              hint,
            )
          }
          let payload = Buffer.from(JSON.stringify(session)).toString('base64url')
          let value = `${payload}.${sign(payload).toString('base64url')}`
          let maxAge = `${MAX_AGE} seconds` as const
          let saved = HttpServerResponse.setCookieUnsafe(response, COOKIE_NAME, value, {
            ...options,
            maxAge,
          })
          return session.auth
            ? HttpServerResponse.setCookieUnsafe(saved, ADMIN_HINT_COOKIE, '1', { ...hint, maxAge })
            : saved
        },
      })
    }),
  )
}
