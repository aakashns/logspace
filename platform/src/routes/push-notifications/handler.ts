// /push-notifications: what the home page's bell (../../../public/push-notifications.js) posts a
// browser's subscription to, and the endpoint of one to forget, as JSON, and the service worker
// that shows the notifications. A refusal is JSON too, `{ message }`, which the bell shows.
import { Effect, Option, Schema, Stream } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'

import { PushCommands, type PushSubscribeFailure } from '../../data/push/commands.ts'
import { PushSubscriptionJson } from '../../data/push/push.ts'
import { Assets } from '../../lib/http/assets.ts'
import { privately } from '../../lib/http/responses.ts'

// A subscription is a few hundred bytes.
const MAX_BODY_BYTES = 4 * 1024

const decodeSubscription = Schema.decodeUnknownOption(Schema.fromJsonString(PushSubscriptionJson))
const decodeEndpoint = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ endpoint: Schema.String })),
)

const answer = (status: number, message: string, headers?: Record<string, string>) =>
  privately(HttpServerResponse.jsonUnsafe({ message }, { status, headers }))

// The request's body as text, if it's at most MAX_BODY_BYTES. One that says it's longer is refused
// before it's read; one that doesn't say is read only until it passes the limit.
const readBody = Effect.gen(function* () {
  let request = yield* HttpServerRequest.HttpServerRequest
  let length = request.headers['content-length']
  if (length !== undefined && !(Number(length) <= MAX_BODY_BYTES)) return undefined
  let size = 0
  let chunks = yield* request.stream.pipe(
    Stream.takeUntil((chunk) => (size += chunk.byteLength) > MAX_BODY_BYTES),
    Stream.runCollect,
    Effect.orElseSucceed(() => undefined),
  )
  if (!chunks || size > MAX_BODY_BYTES) return undefined
  return new TextDecoder().decode(Buffer.concat(chunks))
})

const minutes = (seconds: number) => {
  let count = Math.max(1, Math.ceil(seconds / 60))
  return count === 1 ? 'a minute' : `${count} minutes`
}

// What the bell says for each reason a subscription's refused.
const refusal = (error: PushSubscribeFailure) => {
  switch (error._tag) {
    case 'PushNotificationsOff':
      return answer(404, 'This site doesn’t send notifications right now.')
    case 'PushSubscriptionRejected':
      return answer(400, error.message)
    case 'PushSubscriptionsLimited':
      return answer(
        429,
        `Notifications were turned on from your network too often lately. Try again in ${minutes(error.retryAfter)}.`,
        { 'Retry-After': String(error.retryAfter) },
      )
    case 'PushSubscriptionsFull':
      return answer(503, 'This site can’t send notifications to any more browsers.')
    case 'PushSubscriptionGone':
      return answer(
        410,
        `Your browser’s push service says its subscription isn’t valid (${error.message}). Try again.`,
      )
    case 'PushNotSent':
      return answer(
        502,
        `The site couldn’t send your browser a notification (${error.message}). Try again in a while.`,
      )
  }
}

// Subscribes the browser, sending it a notification that says so: 201, or 200 if the site had it
// already.
const subscribe = Effect.gen(function* () {
  let body = yield* readBody
  if (body === undefined) return answer(413, 'That’s too much for a push subscription.')
  let subscription = decodeSubscription(body)
  if (Option.isNone(subscription)) return answer(400, 'That isn’t a push subscription.')
  let request = yield* HttpServerRequest.HttpServerRequest
  return yield* (yield* PushCommands)
    .subscribe(subscription.value, Option.getOrUndefined(request.remoteAddress))
    .pipe(
      Effect.map((outcome) =>
        privately(
          HttpServerResponse.jsonUnsafe({ outcome }, { status: outcome === 'added' ? 201 : 200 }),
        ),
      ),
      Effect.catch((error) => Effect.succeed(refusal(error))),
    )
})

// Forgets the subscription at the endpoint given, which is as secret as the subscription, whether
// or not the site has it.
const unsubscribe = Effect.gen(function* () {
  let body = yield* readBody
  let given = body === undefined ? Option.none() : decodeEndpoint(body)
  if (Option.isNone(given)) return answer(400, 'That isn’t a push subscription’s endpoint.')
  yield* (yield* PushCommands).unsubscribe(given.value.endpoint)
  return privately(HttpServerResponse.empty({ status: 204 }))
})

// The service worker, for the whole site (though it handles only push notifications), from a URL
// under /push-notifications. Browsers check it for a new version themselves, so it's checked
// with the server each time.
const worker = Effect.map(Assets, ({ pushWorker }) =>
  HttpServerResponse.uint8Array(pushWorker.bytes, {
    contentType: pushWorker.type,
    headers: { 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' },
  }),
)

export const PushNotificationRoutes = HttpRouter.addAll([
  HttpRouter.route('POST', '/push-notifications', subscribe),
  HttpRouter.route('POST', '/push-notifications/remove', unsubscribe),
  HttpRouter.route('GET', '/push-notifications/worker.js', worker),
])
