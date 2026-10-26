// Push notifications, switched on at /admin/subscribers: whether they're on, and sending one
// browser a notification through its push service, encrypted for it and signed with the site's key
// (see ../../lib/web-push.ts). Who's sent what is commands.ts's.
import { Clock, Context, Duration, Effect, Layer, Redacted, Schema } from 'effect'
import { HttpClient, HttpClientRequest } from 'effect/http'

import { AppConfig, MIN_SECRET_LENGTH } from '../../lib/config.ts'
import { derivePushKeys, encryptPushMessage, vapidAuthorization } from '../../lib/web-push.ts'
import { SiteConfigQueries } from '../site/queries.ts'
import { getPushService, type PushMessage, type PushTarget } from './push.ts'

const TIMEOUT = Duration.seconds(15)
// How long a message's token is good for; push services take up to a day.
const TOKEN_SECONDS = 12 * 60 * 60
// As much of a push service's answer as is kept, to say why it refused a message.
const MAX_REASON_LENGTH = 200

// The bell is on the home page and browsers can subscribe (`publicKey` is the key they subscribe
// with), or it isn't. They're off while the switch is, and while AUTH_SESSION_SECRET is too short
// to derive a key from that no one could guess.
export type PushStatus =
  { readonly _tag: 'Off' } | { readonly _tag: 'On'; readonly publicKey: string }

// The push service says the subscription is gone: the browser unsubscribed, or it expired.
export class PushSubscriptionGone extends Schema.TaggedError<PushSubscriptionGone>()(
  'PushSubscriptionGone',
  { message: Schema.String },
) {}

// The push service didn't take the message, or couldn't be reached, with why, in its words.
export class PushNotSent extends Schema.TaggedError<PushNotSent>()('PushNotSent', {
  message: Schema.String,
}) {}

// Apple says why it refused a message as `reason`, like "BadJwtToken"; Google and Mozilla
// answer with text or their own JSON, kept as it is.
const AppleRefusal = Schema.Struct({ reason: Schema.String })
const decodeAppleRefusal = Schema.decodeUnknownOption(Schema.fromJsonString(AppleRefusal))

export class PushDelivery extends Context.Service<
  PushDelivery,
  {
    readonly status: Effect.Effect<PushStatus>
    // The key subscriptions are made with, whether or not they're on: one made with another can't
    // be sent to.
    readonly publicKey: string
    // Sends the browser `message`, which its push service keeps for `ttl` seconds if the browser's
    // offline. It's signed for the site at the origin `message.url` is at.
    readonly send: (
      target: PushTarget,
      message: PushMessage,
      ttl: number,
    ) => Effect.Effect<void, PushSubscriptionGone | PushNotSent>
  }
>()('logspace/PushDelivery') {
  static readonly layer = Layer.effect(
    PushDelivery,
    Effect.gen(function* () {
      let { sessionSecret } = yield* AppConfig
      let queries = yield* SiteConfigQueries
      let client = yield* HttpClient.HttpClient
      // The time, from the clock the app was made with (which the tests control).
      let clock = yield* Clock.Clock
      let secret = Redacted.value(sessionSecret)
      let keys = derivePushKeys(secret)

      let status = Effect.map(queries.saved, (saved): PushStatus => {
        let enabled = saved.pushNotifications?.enabled ?? false
        return enabled && secret.length >= MIN_SECRET_LENGTH
          ? { _tag: 'On', publicKey: keys.publicKey }
          : { _tag: 'Off' }
      }).pipe(Effect.withSpan('PushDelivery.status'))

      let send = Effect.fn('PushDelivery.send')(function* (
        target: PushTarget,
        message: PushMessage,
        ttl: number,
      ) {
        let service = getPushService(target.endpoint)
        if (!service) {
          return yield* new PushNotSent({
            message: 'It isn’t with a push service the site sends to.',
          })
        }
        let name = `${service.name}’s push service`
        let now = yield* Clock.currentTimeMillis.pipe(Effect.provideService(Clock.Clock, clock))
        let body = encryptPushMessage(new TextEncoder().encode(JSON.stringify(message)), target)
        let request = HttpClientRequest.post(target.endpoint).pipe(
          HttpClientRequest.setHeaders({
            authorization: vapidAuthorization(
              keys,
              target.endpoint,
              new URL(message.url).origin,
              Math.floor(now / 1000) + TOKEN_SECONDS,
            ),
            'content-encoding': 'aes128gcm',
            ttl: String(ttl),
            urgency: 'normal',
          }),
          HttpClientRequest.bodyUint8Array(body, 'application/octet-stream'),
        )
        let response = yield* client.execute(request).pipe(
          Effect.timeoutOrElse({
            duration: TIMEOUT,
            orElse: () => Effect.fail(new PushNotSent({ message: `${name} didn’t answer.` })),
          }),
          Effect.catchTag('HttpClientError', () =>
            Effect.fail(new PushNotSent({ message: `Couldn’t reach ${name}.` })),
          ),
        )
        if (response.status >= 200 && response.status < 300) return
        let answer = yield* response.text.pipe(Effect.orElseSucceed(() => ''))
        let refusal = decodeAppleRefusal(answer)
        let reason =
          refusal._tag === 'Some' ? refusal.value.reason : answer.trim().slice(0, MAX_REASON_LENGTH)
        let said = `${name} answered ${response.status}${reason ? `: ${reason}` : '.'}`
        if (response.status === 404 || response.status === 410) {
          return yield* new PushSubscriptionGone({ message: said })
        }
        return yield* new PushNotSent({ message: said })
      })

      return PushDelivery.of({ status, publicKey: keys.publicKey, send })
    }),
  )
}
