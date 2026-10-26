// Push notifications: the home page's bell while they're on, subscribing (with the checks and
// limits that keep anyone from using the site to send requests, and the notification that says
// it worked), unsubscribing, and a new post's notifications, with what happens to each, which a
// fake push service answers for and reads as the browser would.
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { createECDH } from 'node:crypto'
import { Effect, Fiber, Redacted } from 'effect'
import { SqlClient } from 'effect/sql'

import { capture, defined, makeTestApp, TEST_CONFIG } from '../../../test/app.ts'
import { decryptPushMessage } from '../../../test/web-push.ts'
import { PostCommands } from '../../data/posts/commands.ts'
import { PushCommands } from '../../data/push/commands.ts'
import {
  MAX_PUSH_SUBSCRIPTIONS,
  PUSH_SUBSCRIPTIONS_PER_HOUR,
  pushRateLimitKey,
} from '../../data/push/push.ts'
import { SiteConfigCommands } from '../../data/site/commands.ts'
import { derivePushKeys } from '../../lib/web-push.ts'

// What the fake push service was sent, and how it answers each endpoint (201 unless set).
interface Sent {
  readonly url: string
  readonly headers: Headers
  readonly body: Uint8Array
  readonly redirect: RequestRedirect | undefined
}
let sent: Sent[] = []
let answers = new Map<string, () => Response | Promise<Response>>()
// Called with each message sent, for a test to wait for one.
let onSend: (message: Sent) => void = () => {}

const network = {
  resolve: () => Promise.reject(new Error('Not expected')),
  fetch: async (url: URL, init: BunFetchRequestInit) => {
    let message = {
      url: url.href,
      headers: new Headers(init.headers),
      redirect: init.redirect,
      body: new Uint8Array(await new Response(init.body).arrayBuffer()),
    }
    sent.push(message)
    onSend(message)
    let answer = answers.get(url.href)
    return answer ? answer() : new Response(null, { status: 201 })
  },
}
const app = makeTestApp({}, { network })
// The app behind Caddy, which says who's asking in X-Forwarded-For.
const proxied = makeTestApp({ trustProxy: true }, { network })

const SITE_KEY = derivePushKeys(Redacted.value(TEST_CONFIG.sessionSecret))
const HOUR = 60 * 60 * 1000

beforeEach(async () => {
  await app.seedDatabase()
  await proxied.seedDatabase()
  sent = []
  answers = new Map()
  onSend = () => {}
})
afterAll(async () => {
  await app.dispose()
  await proxied.dispose()
})

const switchOn = (enabled = true) =>
  app.run(Effect.flatMap(SiteConfigCommands, (commands) => commands.savePushNotifications(enabled)))

// A browser, with its keys, subscribed at an endpoint of Apple's push service unless it says.
let browsers = 0
function makeBrowser(endpoint = `https://web.push.apple.com/browser-${++browsers}`) {
  let ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  let auth = crypto
    .getRandomValues(new Uint8Array(16))
    .toBase64({ alphabet: 'base64url', omitPadding: true })
  let subscription = {
    endpoint,
    expirationTime: null,
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth },
  }
  return {
    subscription,
    // A message sent to it, as it reads it.
    read: (message: Sent) =>
      JSON.parse(
        new TextDecoder().decode(decryptPushMessage(message.body, ecdh.getPrivateKey(), auth)),
      ),
  }
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
const subscribe = (subscription: unknown) => post('/push-notifications', subscription)

const rows = () =>
  app.run(
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      sql<{
        endpoint: string
        last_error: string | null
        failures: number
        application_server_key: string
      }>`select endpoint, last_error, failures, application_server_key from push_subscriptions
        order by endpoint`.pipe(Effect.orDie),
    ),
  )

const newPost = (id: string, caption: string) =>
  app.run(
    Effect.flatMap(PostCommands, (commands) =>
      commands.save({
        post: { id, type: 'text', date: '2026-10-26T10:00:00Z', caption },
        uploads: [],
        issues: [],
      }),
    ),
  )

describe('the home page', () => {
  it('has no bell while push notifications are off', async () => {
    let response = await app.fetch('/')
    let html = await response.text()
    expect(html).not.toContain('id="push-notifications"')
    expect(html).not.toContain('/assets/push-notifications.')
    let csp = defined(response.headers.get('Content-Security-Policy'), 'a CSP')
    expect(csp).not.toContain('worker-src')
    expect(csp).toContain('trusted-types datastar;')
  })

  it('has the bell beside Subscribe while they’re on, with its script, which may register the service worker', async () => {
    await switchOn()
    let response = await app.fetch('/')
    let html = await response.text()
    let bell = capture(html, /(<span id="push-notifications"[^]*?<\/button>)/)
    expect(bell).toContain('data-state="loading"')
    expect(bell).toContain(`data-public-key="${SITE_KEY.publicKey}"`)
    expect(bell).toContain('data-worker="/push-notifications/worker.js"')
    expect(bell).toContain('data-subscribe-url="/push-notifications"')
    expect(bell).toContain('data-unsubscribe-url="/push-notifications/remove"')
    expect(bell).toContain('aria-label="Notify me of new posts"')
    // The script, with this response's nonce.
    let nonce = capture(html, /data-nonce="([0-9a-f]+)"/)
    expect(html).toMatch(
      new RegExp(
        `<script type="module" src="/assets/push-notifications\\.[0-9a-f]+\\.js" nonce="${nonce}"`,
      ),
    )
    // How to add the site to the Home Screen, how to allow blocked notifications, and what went
    // wrong.
    for (let id of ['push-install', 'push-blocked', 'push-error']) {
      expect(html).toContain(`<dialog id="${id}"`)
    }
    expect(html).toContain('Add to Home Screen')
    let csp = defined(response.headers.get('Content-Security-Policy'), 'a CSP')
    expect(csp).toContain(`script-src 'nonce-${nonce}'; worker-src 'self';`)
    expect(csp).toContain(
      "trusted-types datastar push-notifications; require-trusted-types-for 'script'",
    )
  })

  it('serves the bell’s script, and the service worker, for the whole site', async () => {
    await switchOn()
    let html = await (await app.fetch('/')).text()
    let script = await app.fetch(
      capture(html, /src="(\/assets\/push-notifications\.[0-9a-f]+\.js)"/),
    )
    expect(script.status).toBe(200)
    expect(script.headers.get('Content-Type')).toBe('text/javascript; charset=utf-8')
    expect(await script.text()).toContain("getElementById('push-notifications')")

    let worker = await app.fetch('/push-notifications/worker.js')
    expect(worker.status).toBe(200)
    expect(worker.headers.get('Content-Type')).toBe('text/javascript; charset=utf-8')
    expect(worker.headers.get('Service-Worker-Allowed')).toBe('/')
    expect(worker.headers.get('Cache-Control')).toBe('no-cache')
    let code = await worker.text()
    // It posts to the URLs the site takes them at.
    expect(code).toContain("const SUBSCRIBE_URL = '/push-notifications'")
    expect(code).toContain("const UNSUBSCRIBE_URL = '/push-notifications/remove'")
  })

  it('makes the site an app that opens without the browser’s toolbar, as iPhones need for push', async () => {
    let manifest = await (await app.fetch('/site.webmanifest')).json()
    expect(manifest).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone' })
  })
})

describe('subscribing', () => {
  it('is refused while push notifications are off', async () => {
    let response = await subscribe(makeBrowser().subscription)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      message: 'This site doesn’t send notifications right now.',
    })
    expect(sent).toEqual([])
  })

  it('sends the browser a notification that says it’s on, signed with the site’s key, then keeps it', async () => {
    await switchOn()
    let browser = makeBrowser()
    let response = await subscribe(browser.subscription)
    expect(response.status).toBe(201)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(sent).toHaveLength(1)
    let [message] = sent
    let welcome = defined(message, 'the welcome')
    expect(welcome.url).toBe(browser.subscription.endpoint)
    expect(welcome.headers.get('content-encoding')).toBe('aes128gcm')
    expect(welcome.headers.get('content-type')).toBe('application/octet-stream')
    expect(welcome.headers.get('ttl')).toBe('300')
    expect(welcome.headers.get('authorization')).toMatch(
      new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${SITE_KEY.publicKey}$`),
    )
    expect(browser.read(welcome)).toEqual({
      title: 'Test Site',
      body: 'Notifications are on. You’ll get one for each new post.',
      url: 'https://example.com/',
      icon: 'https://example.com/site/icon-192.png?v=875e8f1b6795',
      tag: 'welcome',
    })
    expect(await rows()).toEqual([
      {
        endpoint: browser.subscription.endpoint,
        last_error: null,
        failures: 0,
        application_server_key: SITE_KEY.publicKey,
      },
    ])

    // The page checks on every visit: the site has it, so nothing's sent.
    let again = await subscribe(browser.subscription)
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ outcome: 'known' })
    expect(sent).toHaveLength(1)
  })

  it('takes subscriptions only with the push services browsers use, with valid keys', async () => {
    await switchOn()
    let { keys } = makeBrowser().subscription
    for (let endpoint of [
      'http://web.push.apple.com/abc',
      'https://web.push.apple.com:8443/abc',
      'https://user:pass@web.push.apple.com/abc',
      'https://push.apple.com.example.com/abc',
      'https://evilpush.apple.com/abc',
      'https://example.com/push',
      'https://127.0.0.1/push',
      `https://fcm.googleapis.com/fcm/send/${'a'.repeat(1024)}`,
      'not a url',
      // Another way of writing an endpoint, so not the one the browser has.
      'https://web.push.apple.com/abc#again',
      'https://web.push.apple.com/abc#',
      'https://WEB.push.apple.com/abc',
      'https://web.push.apple.com:443/abc',
    ]) {
      let response = await subscribe({ endpoint, keys })
      expect(response.status, endpoint).toBe(400)
      expect(await response.json()).toEqual({
        message: 'The subscription isn’t with a push service this site sends to.',
      })
    }
    for (let endpoint of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
      'https://web.push.apple.com/abc',
    ]) {
      let response = await subscribe({ endpoint, keys })
      expect(response.status, endpoint).toBe(201)
    }
    expect(sent.map((message) => new URL(message.url).hostname)).toEqual([
      'fcm.googleapis.com',
      'updates.push.services.mozilla.com',
      'wns2-par02p.notify.windows.com',
      'web.push.apple.com',
    ])

    let endpoint = 'https://web.push.apple.com/keys'
    for (let bad of [
      { p256dh: keys.p256dh.slice(0, -2), auth: keys.auth },
      { p256dh: keys.p256dh, auth: `${keys.auth}AA` },
      { p256dh: 'not-a-key', auth: keys.auth },
    ]) {
      let response = await subscribe({ endpoint, keys: bad })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ message: 'The subscription’s keys aren’t valid.' })
    }
  })

  it('refuses what isn’t a subscription, or is too big to be one', async () => {
    await switchOn()
    for (let body of ['', 'nope', '{}', '{"endpoint": "https://web.push.apple.com/abc"}']) {
      let response = await post('/push-notifications', body)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ message: 'That isn’t a push subscription.' })
    }
    let response = await post('/push-notifications', 'x'.repeat(5000))
    expect(response.status).toBe(413)
    expect(sent).toEqual([])
  })

  it('is refused from another site', async () => {
    await switchOn()
    let response = await post('/push-notifications', makeBrowser().subscription, {
      'Sec-Fetch-Site': 'cross-site',
    })
    expect(response.status).toBe(403)
    expect(sent).toEqual([])
  })

  it('isn’t kept if its push service doesn’t take the notification, saying why', async () => {
    await switchOn()
    let gone = makeBrowser()
    answers.set(gone.subscription.endpoint, () => new Response('', { status: 410 }))
    let response = await subscribe(gone.subscription)
    expect(response.status).toBe(410)
    expect((await response.json()).message).toBe(
      'Your browser’s push service says its subscription isn’t valid (Apple’s push service answered 410.). Try again.',
    )

    let refused = makeBrowser()
    answers.set(refused.subscription.endpoint, () =>
      Response.json({ reason: 'BadJwtToken' }, { status: 403 }),
    )
    response = await subscribe(refused.subscription)
    expect(response.status).toBe(502)
    expect((await response.json()).message).toBe(
      'The site couldn’t send your browser a notification (Apple’s push service answered 403: BadJwtToken). Try again in a while.',
    )

    let unreachable = makeBrowser()
    answers.set(unreachable.subscription.endpoint, () => {
      throw new Error('connection refused')
    })
    response = await subscribe(unreachable.subscription)
    expect(response.status).toBe(502)
    expect((await response.json()).message).toContain('Couldn’t reach Apple’s push service.')

    expect(await rows()).toEqual([])
  })

  it(`takes ${PUSH_SUBSCRIPTIONS_PER_HOUR} new subscriptions an hour from an address`, async () => {
    await switchOn()
    for (let i = 0; i < PUSH_SUBSCRIPTIONS_PER_HOUR; i++) {
      expect((await subscribe(makeBrowser().subscription)).status).toBe(201)
    }
    let response = await subscribe(makeBrowser().subscription)
    expect(response.status).toBe(429)
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(3500)
    expect((await response.json()).message).toBe(
      'Notifications were turned on from your network too often lately. Try again in 60 minutes.',
    )
    expect(sent).toHaveLength(PUSH_SUBSCRIPTIONS_PER_HOUR)
  })

  it('counts each address behind the proxy apart', async () => {
    await proxied.run(
      Effect.flatMap(SiteConfigCommands, (commands) => commands.savePushNotifications(true)),
    )
    let from = (address: string) =>
      proxied.fetch('/push-notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': address },
        body: JSON.stringify(makeBrowser().subscription),
      })
    for (let i = 0; i < PUSH_SUBSCRIPTIONS_PER_HOUR; i++) {
      expect((await from('192.0.2.1')).status).toBe(201)
    }
    expect((await from('192.0.2.1')).status).toBe(429)
    expect((await from('192.0.2.2')).status).toBe(201)
    // A phone's IPv6 addresses change within its network's /64.
    for (let i = 0; i < PUSH_SUBSCRIPTIONS_PER_HOUR; i++) {
      expect((await from(`2001:db8:1:2::${i + 1}`)).status).toBe(201)
    }
    expect((await from('2001:db8:1:2:ffff::1')).status).toBe(429)
    expect((await from('2001:db8:1:3::1')).status).toBe(201)
  })

  it('forgets every address’s count an hour after its last subscription', async () => {
    await switchOn()
    await app.run(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        sql`insert into rate_limits ${sql.insert([
          { key: pushRateLimitKey('192.0.2.9'), count: 3, last_request: Date.now() - 2 * HOUR },
          { key: pushRateLimitKey('192.0.2.10'), count: 3, last_request: Date.now() },
          { key: 'sign-up-otp:ada@example.com', count: 1, last_request: Date.now() - 2 * HOUR },
        ])}`.pipe(Effect.orDie),
      ),
    )
    await subscribe(makeBrowser().subscription)
    let keys = await app.run(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        sql<{ key: string }>`select key from rate_limits order by key`.pipe(Effect.orDie),
      ),
    )
    expect(keys.map((row) => row.key)).toEqual([
      pushRateLimitKey('192.0.2.10'),
      pushRateLimitKey(undefined),
      'sign-up-otp:ada@example.com',
    ])
  })

  it(`takes at most ${MAX_PUSH_SUBSCRIPTIONS} browsers, counting only those made with the site’s key`, async () => {
    await switchOn()
    let { keys } = makeBrowser().subscription
    let fill = (key: string) =>
      app.run(
        Effect.flatMap(SqlClient.SqlClient, (sql) =>
          Effect.gen(function* () {
            yield* sql`delete from push_subscriptions`
            for (let i = 0; i < MAX_PUSH_SUBSCRIPTIONS; i += 500) {
              yield* sql`insert into push_subscriptions ${sql.insert(
                Array.from({ length: 500 }, (_, j) => ({
                  id: `filler-${i + j}`,
                  endpoint: `https://web.push.apple.com/filler-${i + j}`,
                  p256dh: keys.p256dh,
                  auth: keys.auth,
                  application_server_key: key,
                  created_at: '2026-01-01T00:00:00.000Z',
                })),
              )}`
            }
          }).pipe(Effect.orDie),
        ),
      )
    await fill(SITE_KEY.publicKey)
    let response = await subscribe(makeBrowser().subscription)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      message: 'This site can’t send notifications to any more browsers.',
    })
    // After AUTH_SESSION_SECRET changed, the old ones don't take anyone's place.
    await fill('an-old-key')
    expect((await subscribe(makeBrowser().subscription)).status).toBe(201)

    // With one place left, subscriptions whose first notifications are on their way at once
    // can't all take it.
    await fill(SITE_KEY.publicKey)
    await app.run(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        sql`delete from push_subscriptions where endpoint = 'https://web.push.apple.com/filler-0'`.pipe(
          Effect.orDie,
        ),
      ),
    )
    let release = () => {}
    let held = new Promise<void>((resolve) => (release = resolve))
    let first = makeBrowser()
    let second = makeBrowser()
    for (let browser of [first, second]) {
      answers.set(browser.subscription.endpoint, () =>
        held.then(() => new Response(null, { status: 201 })),
      )
    }
    let both = new Promise<void>((resolve) => {
      onSend = () => sent.filter((message) => answers.has(message.url)).length === 2 && resolve()
    })
    let responses = Promise.all([subscribe(first.subscription), subscribe(second.subscription)])
    await both
    release()
    expect((await responses).map((response) => response.status).toSorted()).toEqual([201, 503])
    expect(await rows()).toHaveLength(MAX_PUSH_SUBSCRIPTIONS)

    // Deleting one at /admin/subscribers frees its place at once.
    answers = new Map()
    expect((await subscribe(makeBrowser().subscription)).status).toBe(503)
    await app.adminFetch('/admin/subscribers/push/filler-1/delete', { method: 'POST' })
    expect((await subscribe(makeBrowser().subscription)).status).toBe(201)
  })

  it('counts addresses by the network they’re likely one of', () => {
    expect(pushRateLimitKey('192.0.2.7')).toBe('push-subscription:192.0.2.7')
    expect(pushRateLimitKey('::ffff:192.0.2.7')).toBe('push-subscription:192.0.2.7')
    expect(pushRateLimitKey('2001:db8:1:2:3:4:5:6')).toBe('push-subscription:2001:0db8:0001:0002')
    expect(pushRateLimitKey('2001:db8::1')).toBe('push-subscription:2001:0db8:0000:0000')
    expect(pushRateLimitKey('2001:DB8:1::')).toBe('push-subscription:2001:0db8:0001:0000')
    expect(pushRateLimitKey('::1')).toBe('push-subscription:0000:0000:0000:0000')
    expect(pushRateLimitKey(undefined)).toBe('push-subscription:unknown')
  })
})

describe('unsubscribing', () => {
  it('forgets the subscription, whether or not the site had it, even while they’re off', async () => {
    await switchOn()
    let browser = makeBrowser()
    await subscribe(browser.subscription)
    await switchOn(false)
    let response = await post('/push-notifications/remove', {
      endpoint: browser.subscription.endpoint,
    })
    expect(response.status).toBe(204)
    expect(await rows()).toEqual([])
    response = await post('/push-notifications/remove', { endpoint: browser.subscription.endpoint })
    expect(response.status).toBe(204)
    response = await post('/push-notifications/remove', 'nope')
    expect(response.status).toBe(400)
  })
})

describe('a new post', () => {
  it('is sent to every browser subscribed, once, and not again when it’s edited', async () => {
    await switchOn()
    let first = makeBrowser()
    let second = makeBrowser('https://fcm.googleapis.com/fcm/send/second')
    await subscribe(first.subscription)
    await subscribe(second.subscription)
    sent = []
    let both = new Promise<void>((resolve) => {
      onSend = () => sent.length === 2 && resolve()
    })
    await newPost('n3wp0st001', 'First line of the new post\n\nand more of it')
    await both
    let messages = Object.fromEntries(sent.map((message) => [message.url, message]))
    let expected = {
      title: 'Test Site',
      body: 'First line of the new post and more of it',
      url: 'https://example.com/posts/n3wp0st001',
      icon: 'https://example.com/site/icon-192.png?v=875e8f1b6795',
      tag: 'post-n3wp0st001',
    }
    expect(first.read(defined(messages[first.subscription.endpoint], 'the first'))).toEqual(
      expected,
    )
    expect(second.read(defined(messages[second.subscription.endpoint], 'the second'))).toEqual(
      expected,
    )
    expect(sent[0]?.headers.get('ttl')).toBe(String(7 * 24 * 60 * 60))

    // An edit isn't news.
    sent = []
    await newPost('n3wp0st001', 'First line, edited')
    let fiber = await app.run(
      Effect.flatMap(PushCommands, (push) => push.notifyNewPost('n3wp0st001')),
    )
    // A fan-out started after the edit's save, waited for. One for the edit would have started
    // first, and the fake push service answers at once, so its messages would be here too.
    await app.run(Fiber.join(defined(fiber, 'the fan-out')))
    expect(sent).toHaveLength(2)
  })

  it('has its first photo, at a size for a notification, and says what it has without a caption', async () => {
    await switchOn()
    await app.seedMedia()
    let browser = makeBrowser()
    await subscribe(browser.subscription)
    sent = []
    // The sample photos post, without its caption.
    await app.run(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        sql`update posts set caption = null where id = 'drdp3ei6fd'`.pipe(Effect.orDie),
      ),
    )
    let fiber = await app.run(
      Effect.flatMap(PushCommands, (push) => push.notifyNewPost('drdp3ei6fd')),
    )
    expect(await app.run(Fiber.join(defined(fiber, 'the fan-out')))).toEqual({
      sent: 1,
      failed: 0,
      removed: 0,
    })
    let message = browser.read(defined(sent[0], 'the message'))
    expect(message.body).toBe('3 new photos')
    // The sample photo is 32 pixels wide, so its smallest copy is the one there is.
    expect(message.image).toMatch(
      /^https:\/\/example\.com\/posts\/drdp3ei6fd\/hike-1\.jpg\?w=320&v=[0-9a-f]+$/,
    )
  })

  it('isn’t sent while push notifications are off', async () => {
    await switchOn()
    await subscribe(makeBrowser().subscription)
    await switchOn(false)
    sent = []
    let fiber = await app.run(
      Effect.flatMap(PushCommands, (push) => push.notifyNewPost('xf6ddthtoo')),
    )
    expect(fiber).toBeUndefined()
    expect(sent).toEqual([])
  })

  it('keeps why a push service didn’t take it, and drops only subscriptions that are gone', async () => {
    await switchOn()
    let taken = makeBrowser('https://web.push.apple.com/a-taken')
    let gone = makeBrowser('https://web.push.apple.com/b-gone')
    let failing = makeBrowser('https://web.push.apple.com/c-failing')
    for (let browser of [taken, gone, failing]) await subscribe(browser.subscription)
    // One subscribed with a key the site no longer has.
    await app.run(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        sql`insert into push_subscriptions ${sql.insert({
          id: 'old-key',
          endpoint: 'https://web.push.apple.com/d-old-key',
          p256dh: taken.subscription.keys.p256dh,
          auth: taken.subscription.keys.auth,
          application_server_key: 'an-old-key',
          created_at: '2026-01-01T00:00:00.000Z',
        })}`.pipe(Effect.orDie),
      ),
    )
    answers.set(gone.subscription.endpoint, () => new Response('', { status: 404 }))
    answers.set(failing.subscription.endpoint, () =>
      Response.json({ reason: 'TooManyRequests' }, { status: 429 }),
    )
    sent = []
    let notify = async () => {
      let fiber = await app.run(
        Effect.flatMap(PushCommands, (push) => push.notifyNewPost('xf6ddthtoo')),
      )
      return app.run(Fiber.join(defined(fiber, 'the fan-out')))
    }
    expect(await notify()).toEqual({ sent: 1, failed: 1, removed: 2 })
    expect(sent.map((message) => message.url).toSorted()).toEqual([
      taken.subscription.endpoint,
      gone.subscription.endpoint,
      failing.subscription.endpoint,
    ])
    expect(await rows()).toEqual([
      {
        endpoint: taken.subscription.endpoint,
        last_error: null,
        failures: 0,
        application_server_key: SITE_KEY.publicKey,
      },
      {
        endpoint: failing.subscription.endpoint,
        last_error: 'Apple’s push service answered 429: TooManyRequests',
        failures: 1,
        application_server_key: SITE_KEY.publicKey,
      },
    ])

    // The admin sees which browser it is, and why.
    let admin = await (await app.adminFetch('/admin/subscribers')).text()
    expect(admin).toContain('2 browsers get a notification of each new post.')
    expect(admin).toContain('Apple (Safari)')
    expect(admin).toContain('Not sent')
    expect(admin).toMatch(
      /<span class="push-error" data-ignore>Apple’s push service answered 429: TooManyRequests<\/span>/,
    )

    // A push service that's down or throttling for a while doesn't lose its browsers, which get
    // the next post once it's back.
    for (let i = 0; i < 9; i++) await notify()
    admin = await (await app.adminFetch('/admin/subscribers')).text()
    expect(admin).toContain('10 in a row. Apple’s push service answered 429')
    answers.delete(failing.subscription.endpoint)
    expect(await notify()).toEqual({ sent: 2, failed: 0, removed: 0 })
    expect((await rows()).map((row) => [row.endpoint, row.failures])).toEqual([
      [taken.subscription.endpoint, 0],
      [failing.subscription.endpoint, 0],
    ])
  })

  it('counts failures as they come back, when several posts’ notifications are out at once', async () => {
    await switchOn()
    let browser = makeBrowser()
    await subscribe(browser.subscription)
    answers.set(browser.subscription.endpoint, () => new Response('', { status: 503 }))
    let fibers = await app.run(
      Effect.flatMap(PushCommands, (push) =>
        Effect.all([push.notifyNewPost('xf6ddthtoo'), push.notifyNewPost('drdp3ei6fd')]),
      ),
    )
    for (let fiber of fibers) await app.run(Fiber.join(defined(fiber, 'a fan-out')))
    expect((await rows()).map((row) => row.failures)).toEqual([2])
  })

  it('isn’t sent anywhere a push service redirects to', async () => {
    await switchOn()
    await subscribe(makeBrowser().subscription)
    expect(sent.map((message) => message.redirect)).toEqual(['manual'])
  })
})

describe('/admin/subscribers', () => {
  it('switches push notifications on and off, which the home page follows', async () => {
    let page = await (await app.adminFetch('/admin/subscribers')).text()
    expect(page).toContain('Push notifications')
    expect(page).toContain('No browsers get notifications yet.')
    expect(page).toMatch(
      /<input type="checkbox" role="switch" id="push-notifications-enabled"(?![^>]*checked)[^>]*>/,
    )

    let save = (enabled: boolean) =>
      app.adminFetch('/admin/subscribers/push-notifications', {
        method: 'POST',
        body: new URLSearchParams(enabled ? { enabled: 'on' } : {}),
      })
    let response = await save(true)
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe('/admin/subscribers')
    page = await (await app.adminFetch('/admin/subscribers')).text()
    expect(page).toMatch(
      /<input type="checkbox" role="switch" id="push-notifications-enabled"[^>]* checked/,
    )
    expect(await (await app.fetch('/')).text()).toContain('id="push-notifications"')

    await save(false)
    expect(await (await app.fetch('/')).text()).not.toContain('id="push-notifications"')
  })

  it('is only for the admin', async () => {
    for (let path of [
      '/admin/subscribers/push-notifications',
      '/admin/subscribers/push/some-id/delete',
    ]) {
      let response = await app.fetch(path, {
        method: 'POST',
        body: new URLSearchParams({ enabled: 'on' }),
      })
      expect(response.status).toBe(302)
      expect(response.headers.get('Location')).toBe('/admin/login')
    }
  })

  it('lists browsers by an id of their own, never their endpoint, and deletes one, freeing its place', async () => {
    await switchOn()
    let kept = makeBrowser('https://web.push.apple.com/kept-endpoint')
    let stuck = makeBrowser('https://fcm.googleapis.com/fcm/send/stuck-endpoint')
    await subscribe(kept.subscription)
    await subscribe(stuck.subscription)
    let ids = await app.run(
      Effect.flatMap(SqlClient.SqlClient, (sql) =>
        sql<{ id: string; endpoint: string }>`select id, endpoint from push_subscriptions`.pipe(
          Effect.orDie,
        ),
      ),
    )
    let stuckId = defined(
      ids.find((row) => row.endpoint === stuck.subscription.endpoint),
      'the stuck one',
    ).id
    expect(stuckId).toMatch(/^[0-9a-f-]{36}$/)

    let page = await (await app.adminFetch('/admin/subscribers')).text()
    expect(page).not.toContain('kept-endpoint')
    expect(page).not.toContain('stuck-endpoint')
    expect(page).toContain(`action="/admin/subscribers/push/${stuckId}/delete"`)
    expect(page).toContain('Delete this browser?')

    let response = await app.adminFetch(`/admin/subscribers/push/${stuckId}/delete`, {
      method: 'POST',
    })
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe('/admin/subscribers')
    expect((await rows()).map((row) => row.endpoint)).toEqual([kept.subscription.endpoint])
    // One already gone stays gone.
    response = await app.adminFetch(`/admin/subscribers/push/${stuckId}/delete`, {
      method: 'POST',
    })
    expect(response.status).toBe(303)
  })
})
