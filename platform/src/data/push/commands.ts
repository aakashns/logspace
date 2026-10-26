// Push notifications of new posts, the write side of the `push_subscriptions` table: a browser
// subscribes (as often as its address may, and once the site's sent it a notification that says
// so, which shows its subscription works) or unsubscribes, and each new post is sent to every
// browser subscribed. What happened to each one's last notification is kept, for
// /admin/subscribers; one its push service says is gone is dropped, and one that wasn't taken for
// another reason (an outage, or being throttled) is kept, for the next post.
//
// Sending is best effort, in the background: a post's notifications aren't retried, and those
// not sent yet when the server stops aren't sent.
import { Clock, Context, DateTime, Effect, Fiber, Layer, Schema, Semaphore } from 'effect'
import { SqlClient } from 'effect/sql'

import { PostQueries } from '../posts/queries.ts'
import { SiteConfigQueries } from '../site/queries.ts'
import { isSiteConfigured } from '../site/site.ts'
import { PushDelivery, type PushNotSent, type PushSubscriptionGone } from './delivery.ts'
import {
  checkPushSubscription,
  MAX_PUSH_SUBSCRIPTIONS,
  NEW_POST_TTL_SECONDS,
  newPostMessage,
  PUSH_RATE_LIMIT_PREFIX,
  PUSH_SUBSCRIPTIONS_PER_HOUR,
  type PushMessage,
  type PushSubscriptionJson,
  pushRateLimitKey,
  WELCOME_TTL_SECONDS,
  welcomeMessage,
} from './push.ts'

// Push notifications are switched off (see delivery.ts).
export class PushNotificationsOff extends Schema.TaggedError<PushNotificationsOff>()(
  'PushNotificationsOff',
  {},
) {}

// The subscription isn't one the site takes, for this reason.
export class PushSubscriptionRejected extends Schema.TaggedError<PushSubscriptionRejected>()(
  'PushSubscriptionRejected',
  { message: Schema.String },
) {}

// The address made as many subscriptions as it may lately, and can make another in `retryAfter`
// seconds.
export class PushSubscriptionsLimited extends Schema.TaggedError<PushSubscriptionsLimited>()(
  'PushSubscriptionsLimited',
  { retryAfter: Schema.Int },
) {}

// The site sends to as many browsers as it may (MAX_PUSH_SUBSCRIPTIONS).
export class PushSubscriptionsFull extends Schema.TaggedError<PushSubscriptionsFull>()(
  'PushSubscriptionsFull',
  { limit: Schema.Int },
) {}

export type PushSubscribeFailure =
  | PushNotificationsOff
  | PushSubscriptionRejected
  | PushSubscriptionsLimited
  | PushSubscriptionsFull
  | PushSubscriptionGone
  | PushNotSent

// What a new post's notifications came to.
export interface PushFanOut {
  readonly sent: number
  readonly failed: number
  readonly removed: number
}

const HOUR = 60 * 60 * 1000

interface SubscriptionRow {
  readonly endpoint: string
  readonly p256dh: string
  readonly auth: string
  readonly application_server_key: string
}

export class PushCommands extends Context.Service<
  PushCommands,
  {
    // Takes the browser's subscription, from `address` (see pushRateLimitKey), and sends it a
    // notification that says it's subscribed. One the site has already is left as it is: `known`.
    readonly subscribe: (
      subscription: PushSubscriptionJson,
      address: string | undefined,
    ) => Effect.Effect<'added' | 'known', PushSubscribeFailure>
    // Forgets the subscription at `endpoint`. One already gone stays gone.
    readonly unsubscribe: (endpoint: string) => Effect.Effect<void>
    // Sends the newly published post with this id to every browser subscribed, in the
    // background, while push notifications are on. The fiber is for the tests, which wait for it.
    readonly notifyNewPost: (
      id: string,
    ) => Effect.Effect<Fiber.Fiber<PushFanOut | undefined> | undefined>
  }
>()('logspace/PushCommands') {
  static readonly layer = Layer.effect(
    PushCommands,
    Effect.gen(function* () {
      let sql = yield* SqlClient.SqlClient
      let delivery = yield* PushDelivery
      let siteConfig = yield* SiteConfigQueries
      let posts = yield* PostQueries
      let scope = yield* Effect.scope
      // Counting subscriptions happens one at a time.
      let counting = yield* Semaphore.make(1)
      // The time, from the clock the app was made with (which the tests control).
      let clock = yield* Clock.Clock
      let currentTime = DateTime.now.pipe(Effect.provideService(Clock.Clock, clock))

      // The site, while push notifications are on and it's configured, for its messages.
      let openSite = Effect.gen(function* () {
        let status = yield* delivery.status
        let site = yield* siteConfig.saved
        return status._tag === 'On' && isSiteConfigured(site) ? site : undefined
      })

      // Whether the site has as many subscriptions as it takes, besides the one at `endpoint`,
      // counting only those it can send to, made with its key.
      let full = (endpoint: string) =>
        Effect.map(
          sql<{ count: number }>`select count(*) as count from push_subscriptions
            where endpoint != ${endpoint} and application_server_key = ${delivery.publicKey}`,
          ([total]) => (total?.count ?? 0) >= MAX_PUSH_SUBSCRIPTIONS,
        )

      // Counts a new subscription from the address, or says why it can't be made: the address
      // made too many lately, or the site has as many as it takes. An address's count goes an
      // hour after its last.
      let countSubscription = (address: string | undefined, endpoint: string, now: number) =>
        Effect.gen(function* () {
          let key = pushRateLimitKey(address)
          yield* sql`delete from rate_limits
            where key like ${`${PUSH_RATE_LIMIT_PREFIX}%`} and last_request <= ${now - HOUR}`
          let [row] = yield* sql<{ count: number; last_request: number }>`
            select count, last_request from rate_limits where key = ${key}`
          if (row && row.count >= PUSH_SUBSCRIPTIONS_PER_HOUR) {
            return new PushSubscriptionsLimited({
              retryAfter: Math.ceil((row.last_request + HOUR - now) / 1000),
            })
          }
          if (yield* full(endpoint)) {
            return new PushSubscriptionsFull({ limit: MAX_PUSH_SUBSCRIPTIONS })
          }
          yield* sql`insert into rate_limits ${sql.insert({ key, count: 1, last_request: now })}
            on conflict (key) do update set count = count + 1, last_request = ${now}`
          return undefined
        }).pipe(sql.withTransaction, Effect.orDie, counting.withPermit)

      let subscribe = Effect.fn('PushCommands.subscribe')(function* (
        subscription: PushSubscriptionJson,
        address: string | undefined,
      ) {
        let site = yield* openSite
        if (!site) return yield* new PushNotificationsOff()
        let checked = checkPushSubscription(subscription)
        if (checked._tag === 'Failure') {
          return yield* new PushSubscriptionRejected({ message: checked.failure })
        }
        let target = checked.success
        let [saved] = yield* sql<SubscriptionRow>`
          select endpoint, p256dh, auth, application_server_key
          from push_subscriptions where endpoint = ${target.endpoint}`.pipe(Effect.orDie)
        if (
          saved &&
          saved.p256dh === target.p256dh &&
          saved.auth === target.auth &&
          saved.application_server_key === delivery.publicKey
        ) {
          return 'known' as const
        }
        let limited = yield* countSubscription(
          address,
          target.endpoint,
          DateTime.toEpochMillis(yield* currentTime),
        )
        if (limited) {
          yield* Effect.logWarning('Push subscription refused').pipe(
            Effect.annotateLogs({ reason: limited._tag, address: pushRateLimitKey(address) }),
          )
          return yield* limited
        }
        yield* delivery
          .send(target, welcomeMessage(site), WELCOME_TTL_SECONDS)
          .pipe(
            Effect.tapError((error) =>
              Effect.logWarning('Push subscription’s first notification not sent').pipe(
                Effect.annotateLogs({ reason: error.message }),
              ),
            ),
          )
        let now = DateTime.formatIso(yield* currentTime)
        let fields = {
          p256dh: target.p256dh,
          auth: target.auth,
          application_server_key: delivery.publicKey,
          last_sent_at: now,
          last_error: null,
          failures: 0,
        }
        // Checked again as it's saved, as others may have been saved while the first
        // notification was on its way.
        let stored = yield* Effect.gen(function* () {
          if (yield* full(target.endpoint)) return false
          yield* sql`insert into push_subscriptions ${sql.insert({
            endpoint: target.endpoint,
            created_at: now,
            ...fields,
          })} on conflict (endpoint) do update set ${sql.update({ ...fields, created_at: now })}`
          return true
        }).pipe(sql.withTransaction, Effect.orDie, counting.withPermit)
        if (!stored) return yield* new PushSubscriptionsFull({ limit: MAX_PUSH_SUBSCRIPTIONS })
        return 'added' as const
      })

      let unsubscribe = Effect.fn('PushCommands.unsubscribe')(function* (endpoint: string) {
        yield* sql`delete from push_subscriptions where endpoint = ${endpoint}`.pipe(Effect.orDie)
      })

      // Keeps what happened to a subscription's notification: taken, or not, and why, counting
      // those not taken in a row in the database, as several posts' notifications can be on
      // their way at once. One whose push service says it's gone is dropped.
      let record = (row: SubscriptionRow, error: PushSubscriptionGone | PushNotSent | undefined) =>
        Effect.gen(function* () {
          let now = DateTime.formatIso(yield* currentTime)
          if (!error) {
            yield* sql`update push_subscriptions
              set last_sent_at = ${now}, last_error = null, failures = 0
              where endpoint = ${row.endpoint}`
            return 'sent' as const
          }
          if (error._tag === 'PushSubscriptionGone') {
            yield* sql`delete from push_subscriptions where endpoint = ${row.endpoint}`
            return 'removed' as const
          }
          yield* sql`update push_subscriptions
            set last_sent_at = ${now}, last_error = ${error.message}, failures = failures + 1
            where endpoint = ${row.endpoint}`
          return 'failed' as const
        }).pipe(Effect.orDie)

      // Sends `message` to every browser subscribed with the site's key, a few at a time. Those
      // subscribed with a key the site no longer has (AUTH_SESSION_SECRET changed) can't be sent
      // to, so they go; their browsers subscribe again on their next visit.
      let sendToAll = (message: PushMessage, postId: string) =>
        Effect.gen(function* () {
          let stale = yield* sql`delete from push_subscriptions
            where application_server_key != ${delivery.publicKey} returning endpoint`
          let rows = yield* sql<SubscriptionRow>`
            select endpoint, p256dh, auth, application_server_key
            from push_subscriptions`
          let outcomes = yield* Effect.forEach(
            rows,
            (row) =>
              delivery.send(row, message, NEW_POST_TTL_SECONDS).pipe(
                Effect.matchEffect({
                  onSuccess: () => record(row, undefined),
                  onFailure: (error) =>
                    Effect.logWarning('Push notification not sent').pipe(
                      Effect.annotateLogs({ post: postId, reason: error.message }),
                      Effect.andThen(record(row, error)),
                    ),
                }),
              ),
            { concurrency: 8 },
          )
          let fanOut: PushFanOut = {
            sent: outcomes.filter((outcome) => outcome === 'sent').length,
            failed: outcomes.filter((outcome) => outcome === 'failed').length,
            removed: outcomes.filter((outcome) => outcome === 'removed').length + stale.length,
          }
          yield* Effect.logInfo('Push notifications sent').pipe(
            Effect.annotateLogs({ post: postId, ...fanOut }),
          )
          return fanOut
        }).pipe(Effect.orDie)

      // The post as its page shows it, with its media's public URLs.
      let notifyNewPost = Effect.fn('PushCommands.notifyNewPost')(function* (id: string) {
        let site = yield* openSite
        let post = yield* posts.find(id)
        if (!site || !post) return undefined
        return yield* sendToAll(newPostMessage(post, site), id).pipe(
          Effect.catchCause((cause) =>
            Effect.as(Effect.logError('Push notifications failed', cause), undefined),
          ),
          Effect.forkIn(scope),
        )
      })

      return PushCommands.of({ subscribe, unsubscribe, notifyNewPost })
    }),
  )
}
