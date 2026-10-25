// Cloudflare Turnstile, set up at /admin/integrations: whether it's set up, and checking a
// widget's answer (its token) with Cloudflare, which is the only way to know a token is real.
// https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
import { Context, Duration, Effect, Layer, Schema } from 'effect'
import { HttpClient, HttpClientRequest } from 'effect/http'

import { Secrets, SecretUnreadable } from '../../lib/secrets.ts'
import { SiteConfigQueries } from './queries.ts'
import { TURNSTILE_SECRET_PURPOSE } from './site.ts'

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
// Cloudflare's limit; a longer token can't be one of its.
const MAX_TOKEN_LENGTH = 2048
const TIMEOUT = Duration.seconds(10)

// Turnstile as /admin/integrations shows it. The secret key's last characters say which one is
// saved, without showing it.
export type TurnstileStatus =
  | { readonly _tag: 'NotSetUp' }
  | { readonly _tag: 'SetUp'; readonly siteKey: string; readonly secretKeyEnding: string }
  | { readonly _tag: 'SecretUnreadable'; readonly siteKey: string }

// There are no keys to check a token with.
export class TurnstileNotSetUp extends Schema.TaggedError<TurnstileNotSetUp>()(
  'TurnstileNotSetUp',
  {},
) {}

// No token was sent: the challenge wasn't completed, or the browser didn't run the widget.
export class TurnstileTokenMissing extends Schema.TaggedError<TurnstileTokenMissing>()(
  'TurnstileTokenMissing',
  {},
) {}

// Cloudflare refused the token, with its reasons, like "invalid-input-secret" for a wrong secret
// key or "timeout-or-duplicate" for a token that's expired or been checked already.
export class TurnstileDenied extends Schema.TaggedError<TurnstileDenied>()('TurnstileDenied', {
  codes: Schema.Array(Schema.String),
}) {}

// Cloudflare couldn't be asked: the request failed or took too long, or its answer was an HTTP
// error or not one it gives.
export class TurnstileUnavailable extends Schema.TaggedError<TurnstileUnavailable>()(
  'TurnstileUnavailable',
  {
    reason: Schema.Literals(['network', 'timeout', 'status', 'response']),
    status: Schema.optionalKey(Schema.Number),
  },
) {}

export type TurnstileFailure =
  | TurnstileNotSetUp
  | SecretUnreadable
  | TurnstileTokenMissing
  | TurnstileDenied
  | TurnstileUnavailable

// The parts of Cloudflare's answer that are used.
const SiteverifyResponse = Schema.Struct({
  success: Schema.Boolean,
  'error-codes': Schema.optionalKey(Schema.Array(Schema.String)),
  // The site the widget was solved on.
  hostname: Schema.optionalKey(Schema.String),
})
const decodeSiteverifyResponse = Schema.decodeUnknownEffect(SiteverifyResponse)

export class Turnstile extends Context.Service<
  Turnstile,
  {
    readonly status: Effect.Effect<TurnstileStatus>
    // Checks a widget's token with Cloudflare, returning the site it was solved on.
    readonly verify: (token: string) => Effect.Effect<{ hostname: string }, TurnstileFailure>
  }
>()('logspace/Turnstile') {
  static readonly layer = Layer.effect(
    Turnstile,
    Effect.gen(function* () {
      let queries = yield* SiteConfigQueries
      let secrets = yield* Secrets
      let client = yield* HttpClient.HttpClient

      let status = Effect.gen(function* () {
        let saved = (yield* queries.saved).turnstile
        if (!saved) return { _tag: 'NotSetUp' } as const
        let { siteKey } = saved
        return yield* secrets.open(saved.secretKey, TURNSTILE_SECRET_PURPOSE).pipe(
          Effect.match({
            onSuccess: (secret) =>
              ({ _tag: 'SetUp', siteKey, secretKeyEnding: secret.slice(-4) }) as const,
            onFailure: () => ({ _tag: 'SecretUnreadable', siteKey }) as const,
          }),
        )
      }).pipe(Effect.withSpan('Turnstile.status'))

      // Asks Cloudflare, telling each way it can fail apart.
      let siteverify = (secret: string, token: string) =>
        client
          .execute(
            HttpClientRequest.post(SITEVERIFY_URL).pipe(
              HttpClientRequest.bodyUrlParams({ secret, response: token }),
            ),
          )
          .pipe(
            Effect.catchTag('HttpClientError', () =>
              Effect.fail(new TurnstileUnavailable({ reason: 'network' })),
            ),
            Effect.flatMap((response) =>
              response.status >= 200 && response.status < 300
                ? response.json.pipe(
                    Effect.flatMap(decodeSiteverifyResponse),
                    Effect.catchTags({
                      HttpClientError: () =>
                        Effect.fail(new TurnstileUnavailable({ reason: 'response' })),
                      SchemaError: () =>
                        Effect.fail(new TurnstileUnavailable({ reason: 'response' })),
                    }),
                  )
                : Effect.fail(
                    new TurnstileUnavailable({ reason: 'status', status: response.status }),
                  ),
            ),
            Effect.timeoutOrElse({
              duration: TIMEOUT,
              orElse: () => Effect.fail(new TurnstileUnavailable({ reason: 'timeout' })),
            }),
          )

      let verify = Effect.fn('Turnstile.verify')(function* (token: string) {
        let saved = (yield* queries.saved).turnstile
        if (!saved) return yield* new TurnstileNotSetUp()
        let secret = yield* secrets.open(saved.secretKey, TURNSTILE_SECRET_PURPOSE)
        if (!token) return yield* new TurnstileTokenMissing()
        // As Cloudflare would answer, without asking it.
        if (token.length > MAX_TOKEN_LENGTH) {
          return yield* new TurnstileDenied({ codes: ['invalid-input-response'] })
        }
        let answer = yield* siteverify(secret, token)
        if (!answer.success) {
          return yield* new TurnstileDenied({ codes: answer['error-codes'] ?? [] })
        }
        return { hostname: answer.hostname ?? '' }
      })

      return Turnstile.of({ status, verify })
    }),
  )
}
