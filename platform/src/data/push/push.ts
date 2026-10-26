// Push notifications of new posts: what a browser's subscription is, which ones the site takes,
// and the notifications it sends. Pure: sending them is delivery.ts's, and the subscriptions are
// stored by commands.ts.
import { Result, Schema } from 'effect'

import { urls } from '../../lib/urls.ts'
import { isPushAuthSecret, isPushPublicKey } from '../../lib/web-push.ts'
import type { Photo, Post } from '../posts/presentation.ts'
import { captionText } from '../posts/caption.ts'
import { getIconHref } from '../site/site-images.ts'
import type { SiteConfig } from '../site/site.ts'

// A subscription as the browser sends it, PushSubscription.toJSON()'s shape (which has an
// `expirationTime` too, which push services leave null).
export const PushSubscriptionJson = Schema.Struct({
  endpoint: Schema.String,
  keys: Schema.Struct({ p256dh: Schema.String, auth: Schema.String }),
})
export type PushSubscriptionJson = typeof PushSubscriptionJson.Type

// A subscription the site took: its endpoint, at one of PUSH_SERVICES, and its keys.
export interface PushTarget {
  readonly endpoint: string
  readonly p256dh: string
  readonly auth: string
}

// The push services browsers subscribe with, by the domain their endpoints are at (or under), and
// what to call each. The site sends only to these, so a subscription can't make it send requests
// anywhere else.
export const PUSH_SERVICES = [
  { domain: 'push.apple.com', name: 'Apple', browsers: 'Safari' },
  { domain: 'fcm.googleapis.com', name: 'Google', browsers: 'Chrome' },
  { domain: 'push.services.mozilla.com', name: 'Mozilla', browsers: 'Firefox' },
  { domain: 'notify.windows.com', name: 'Microsoft', browsers: 'Edge' },
] as const
export type PushService = (typeof PUSH_SERVICES)[number]

// The push service an endpoint is at, if it's one the site sends to: over HTTPS, at its default
// port, with no user name or password.
export function getPushService(endpoint: string): PushService | undefined {
  let url = URL.parse(endpoint)
  if (!url || url.protocol !== 'https:' || url.port || url.username || url.password) return
  return PUSH_SERVICES.find(
    ({ domain }) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
  )
}

// Endpoints are about 200 characters; this leaves plenty of room.
export const MAX_ENDPOINT_LENGTH = 1024

// Checks a subscription a browser sent, saying what's wrong with it if it isn't one the site takes.
// Its endpoint is the subscription's identity, so only its one way of being written is taken
// (as URL writes it, with no fragment), so the same one can't be subscribed again as another.
export function checkPushSubscription(
  subscription: PushSubscriptionJson,
): Result.Result<PushTarget, string> {
  let { endpoint, keys } = subscription
  if (
    endpoint.length > MAX_ENDPOINT_LENGTH ||
    endpoint.includes('#') ||
    URL.parse(endpoint)?.href !== endpoint ||
    !getPushService(endpoint)
  ) {
    return Result.fail('The subscription isn’t with a push service this site sends to.')
  }
  if (!isPushPublicKey(keys.p256dh) || !isPushAuthSecret(keys.auth)) {
    return Result.fail('The subscription’s keys aren’t valid.')
  }
  return Result.succeed({ endpoint, p256dh: keys.p256dh, auth: keys.auth })
}

// A notification, as the site's service worker shows it (see ../../../public/push-worker.js):
// `url` is opened when it's clicked, and a notification with the same `tag` replaces it.
// `icon` is the site's, and `image`, which only some browsers show, a post's photo. URLs are
// absolute.
export interface PushMessage {
  readonly title: string
  readonly body: string
  readonly url: string
  readonly icon: string
  readonly tag: string
  readonly image?: string | undefined
}

// How long a push service keeps a notification for a browser that's offline: a new post's for a
// week, and the one that says notifications are on for five minutes, as it's no news later.
export const NEW_POST_TTL_SECONDS = 7 * 24 * 60 * 60
export const WELCOME_TTL_SECONDS = 5 * 60

// Short enough that a message is always far under what push services take (see
// MAX_PUSH_PLAINTEXT_BYTES).
const MAX_TITLE_LENGTH = 100
const MAX_BODY_LENGTH = 160
// Wide enough for a notification's large image on a 2x screen.
const IMAGE_WIDTH = 800

const clamp = (text: string, length: number) =>
  text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text

const siteIcon = (site: SiteConfig) => new URL(getIconHref(site, 'icon-192.png'), site.siteUrl).href

// The notification that says this browser will get one for each new post, which also shows that
// sending to it works.
export function welcomeMessage(site: SiteConfig): PushMessage {
  return {
    title: clamp(site.siteTitle, MAX_TITLE_LENGTH),
    body: 'Notifications are on. You’ll get one for each new post.',
    url: new URL(urls.home(), site.siteUrl).href,
    icon: siteIcon(site),
    tag: 'welcome',
  }
}

// A new post's notification: the site's title over the start of its caption (or what it has, if
// it has none), with its first photo or its video's poster.
export function newPostMessage(post: Post, site: SiteConfig): PushMessage {
  let text = post.caption ? captionText(post.caption).replace(/\s+/g, ' ') : ''
  let image =
    post.type === 'photos'
      ? photoUrl(post.photos[0])
      : post.type === 'video'
        ? post.video.poster
        : undefined
  return {
    title: clamp(site.siteTitle, MAX_TITLE_LENGTH),
    body: clamp(text, MAX_BODY_LENGTH) || describeMedia(post),
    url: new URL(urls.post(post.id), site.siteUrl).href,
    icon: siteIcon(site),
    tag: `post-${post.id}`,
    image: image && new URL(image, site.siteUrl).href,
  }
}

// A photo's resized copy that's at least IMAGE_WIDTH wide (or its widest), from its srcset. One
// that isn't resized is left out, since it can be as big as it was uploaded.
function photoUrl(photo: Photo): string | undefined {
  let sources = (photo.srcset ?? '').split(', ').flatMap((source) => {
    let [url, width] = source.split(' ')
    return url && width ? [{ url, width: Number.parseInt(width) }] : []
  })
  return (sources.find((source) => source.width >= IMAGE_WIDTH) ?? sources.at(-1))?.url
}

function describeMedia(post: Post): string {
  switch (post.type) {
    case 'photos':
      return post.photos.length === 1 ? 'A new photo' : `${post.photos.length} new photos`
    case 'video':
      return 'A new video'
    case 'text':
      return 'A new post'
  }
}

// A browser subscribed, as /admin/subscribers lists it: its push service (not its endpoint, which
// is all it takes to send it notifications, or to unsubscribe it), when it subscribed, and what
// happened to its last notification.
export interface PushSubscriber {
  readonly id: string
  readonly service: PushService | undefined
  readonly createdAt: string
  readonly lastSentAt: string | undefined
  // Why the last one wasn't taken, with how many in a row weren't, if it wasn't.
  readonly lastError: string | undefined
  readonly failures: number
}

// The most browsers the site sends notifications to, which bounds the work a new post makes.
export const MAX_PUSH_SUBSCRIPTIONS = 10_000
// How many new subscriptions one address can make an hour.
export const PUSH_SUBSCRIPTIONS_PER_HOUR = 20

// What the `key`s below start with.
export const PUSH_RATE_LIMIT_PREFIX = 'push-subscription:'

// The `key` of how many subscriptions an address made lately, in the `rate_limits` table. An IPv6
// address is counted by its /64, which is usually one home or phone; an IPv4 address the server
// sees as IPv6 (like ::ffff:192.0.2.1) by itself. Without an address (as in the tests), they're
// counted together.
export function pushRateLimitKey(address: string | undefined): string {
  let mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address ?? '')?.[1]
  let counted = mapped ?? (address?.includes(':') ? ipv6Prefix(address) : address)
  return `${PUSH_RATE_LIMIT_PREFIX}${counted || 'unknown'}`
}

// The first four groups of an IPv6 address, written out, like 2001:0db8:0000:0000.
function ipv6Prefix(address: string): string {
  let [head = '', tail] = address.toLowerCase().split('::')
  let start = head ? head.split(':') : []
  let end = tail ? tail.split(':') : []
  let zeros = tail === undefined ? [] : Array<string>(8 - start.length - end.length).fill('0')
  return [...start, ...zeros, ...end]
    .slice(0, 4)
    .map((group) => group.padStart(4, '0'))
    .join(':')
}
