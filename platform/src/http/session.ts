// /admin is protected by one admin password, ADMIN_PASSWORD. Logging in stores a fingerprint of
// it in a session cookie signed with AUTH_SESSION_SECRET, so changing the password logs out every
// browser, and so does changing the secret, since old cookies no longer verify. /admin stays
// switched off until both are set and at least 16 characters.
//
// The session is the cookie: base64url JSON, a dot, and its HMAC-SHA256 signature. It's
// HttpOnly, SameSite=Lax, Secure in production, and sent only to /admin, so public pages never
// receive it. Beside it, a logged-in browser gets a cookie that only says so (ADMIN_HINT_COOKIE),
// sent to every page, so they can show the navbar's link to the composer. It proves nothing: a
// made-up one just shows a link that leads to the login page.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { Context, Effect, Layer, Option, Redacted, Schema } from 'effect'
import { HttpServerRequest, HttpServerResponse } from 'effect/http'

import { AppConfig } from '../config.ts'

const COOKIE_NAME = 'admin_session'
export const ADMIN_HINT_COOKIE = 'admin'
const MAX_AGE = 60 * 60 * 24 * 30
const MIN_SECRET_LENGTH = 16

export const Session = Schema.Struct({
  // A new id on login guards against session fixation.
  id: Schema.String,
  // The password's fingerprint, once logged in.
  auth: Schema.optionalKey(Schema.String),
  // A note for the next page, like "the settings were saved", which reading clears.
  flash: Schema.optionalKey(Schema.String),
})
export type Session = typeof Session.Type

// The cookie's payload, base64url JSON.
const decodePayload = Schema.decodeUnknownOption(Schema.fromJsonString(Session))

// Someone who isn't logged in as admin asked for an admin page.
export class NotLoggedIn extends Schema.TaggedError<NotLoggedIn>()('NotLoggedIn', {}) {}

export class AdminAuth extends Context.Service<
  AdminAuth,
  {
    readonly enabled: boolean
    readonly checkPassword: (input: unknown) => boolean
    // The request's session, or a new empty one.
    readonly session: Effect.Effect<Session, never, HttpServerRequest.HttpServerRequest>
    // The request's session if it's logged in as admin.
    readonly requireLogin: Effect.Effect<Session, NotLoggedIn, HttpServerRequest.HttpServerRequest>
    // A new logged-in session.
    readonly logIn: () => Session
    // Sets the session's cookie on a response, or with undefined, clears it. The hint cookie is
    // set while it's logged in, and cleared with it.
    readonly saveSession: (
      response: HttpServerResponse.HttpServerResponse,
      session: Session | undefined,
    ) => HttpServerResponse.HttpServerResponse
  }
>()('logspace/AdminAuth') {
  static readonly layer = Layer.effect(
    AdminAuth,
    Effect.gen(function* () {
      let config = yield* AppConfig
      let password = Redacted.value(config.adminPassword)
      let secret = Redacted.value(config.sessionSecret)
      let enabled = password.length >= MIN_SECRET_LENGTH && secret.length >= MIN_SECRET_LENGTH
      let fingerprint = createHmac('sha256', secret).update(password).digest('base64url')
      let sign = (payload: string) => createHmac('sha256', secret).update(payload).digest()

      let read = (cookie: string | undefined): Session | undefined => {
        if (!enabled || !cookie) return undefined
        let [payload, signature] = cookie.split('.')
        if (!payload || !signature) return undefined
        let expected = sign(payload)
        let given = Buffer.from(signature, 'base64url')
        if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined
        return Option.getOrUndefined(
          decodePayload(Buffer.from(payload, 'base64url').toString('utf8')),
        )
      }

      let session = Effect.map(
        HttpServerRequest.HttpServerRequest,
        (request): Session => read(request.cookies[COOKIE_NAME]) ?? { id: crypto.randomUUID() },
      )

      return AdminAuth.of({
        enabled,
        checkPassword: (input) => {
          if (!enabled || typeof input !== 'string') return false
          // Hashing first gives equal-length buffers, so the comparison takes the same time
          // either way.
          let hash = (value: string) => createHash('sha256').update(value).digest()
          return timingSafeEqual(hash(input), hash(password))
        },
        session,
        requireLogin: Effect.flatMap(session, (session) =>
          enabled && session.auth === fingerprint
            ? Effect.succeed(session)
            : Effect.fail(new NotLoggedIn()),
        ),
        logIn: () => ({ id: crypto.randomUUID(), auth: fingerprint }),
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
