// The site's service worker, served at /push-notifications/worker.js: it shows the push
// notifications the site sends (see src/data/push/), opens a post when its notification is
// clicked, and keeps the site's copy of this browser's subscription when its push service
// replaces it. It handles nothing else (no fetch handler), so pages load as they would without it.
// It's registered by push-notifications.js, beside it.

// Where the site takes a subscription, and forgets one (see src/lib/urls.ts).
const SUBSCRIBE_URL = '/push-notifications'
const UNSUBSCRIBE_URL = '/push-notifications/remove'

// A new version takes over as soon as it's installed: it keeps nothing it'd need to hand over.
self.addEventListener('install', () => self.skipWaiting())

// Every push is shown: browsers expect a notification for each (Safari stops sending them to a
// site that doesn't), so one that can't be read is shown as news from the site.
self.addEventListener('push', (event) => {
  event.waitUntil(show(event.data))
})

async function show(data) {
  let message = {}
  try {
    message = data ? data.json() : {}
  } catch (error) {
    console.error('Couldn’t read a push notification', error)
  }
  let title = typeof message.title === 'string' ? message.title : self.location.host
  await self.registration.showNotification(title, {
    body: typeof message.body === 'string' ? message.body : 'There’s something new.',
    icon: typeof message.icon === 'string' ? message.icon : undefined,
    image: typeof message.image === 'string' ? message.image : undefined,
    tag: typeof message.tag === 'string' ? message.tag : undefined,
    data: { url: typeof message.url === 'string' ? message.url : '/' },
  })
}

// Opens the notification's page, on this site only, in a window that has it if there's one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  let url = new URL(event.notification.data?.url ?? '/', self.location.origin)
  if (url.origin !== self.location.origin) url = new URL('/', self.location.origin)
  event.waitUntil(focusOrOpen(url.href))
})

async function focusOrOpen(url) {
  let windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  let open = windows.find((client) => client.url === url)
  if (open) return open.focus()
  return self.clients.openWindow(url)
}

// The push service replaced the subscription (or dropped it): the site's told about the new one,
// made with the same key, and to forget the old.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(resubscribe(event.oldSubscription, event.newSubscription))
})

async function resubscribe(previous, next) {
  try {
    let key = previous?.options.applicationServerKey
    let subscription =
      next ??
      (key
        ? await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: key,
          })
        : null)
    if (subscription) await post(SUBSCRIBE_URL, subscription.toJSON())
    if (previous && previous.endpoint !== subscription?.endpoint) {
      await post(UNSUBSCRIBE_URL, { endpoint: previous.endpoint })
    }
  } catch (error) {
    console.error('Couldn’t renew the push subscription', error)
  }
}

async function post(url, body) {
  let response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
}
