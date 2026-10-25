// Subscribing: the home page's button, the form with Turnstile, the code emailed (with Resend,
// which a fake network answers for, as it does for Cloudflare), and the account it makes.
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { Clock, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { capture, defined, makeTestApp } from '../../../test/app.ts'
import { SiteConfigCommands } from '../../data/site/commands.ts'

const SITE_KEY = '0x4AAAAAAAsiteKey123'
const RESEND = 'https://api.resend.com/emails'

// The emails Resend was asked to send, and the tokens Cloudflare was asked about. Cloudflare
// accepts "good-token" and nothing else. Resend answers once `resend` lets it, with `resendFails`
// set refusing the email.
let emails: { to: string; subject: string; text: string }[] = []
let tokens: string[] = []
let resend: () => Promise<void> = () => Promise.resolve()
let resendFails = false

// The time, which the tests move on.
let now = 1_800_000_000_000
const later = (milliseconds: number) => {
  now += milliseconds
}
const baseClock = Effect.runSync(Clock.Clock)
const clock: Clock.Clock = {
  sleep: (duration) => baseClock.sleep(duration),
  monotonicTimeNanosUnsafe: () => baseClock.monotonicTimeNanosUnsafe(),
  monotonicTimeNanos: baseClock.monotonicTimeNanos,
  currentTimeMillisUnsafe: () => now,
  currentTimeMillis: Effect.sync(() => now),
  currentTimeNanosUnsafe: () => BigInt(now) * 1_000_000n,
  currentTimeNanos: Effect.sync(() => BigInt(now) * 1_000_000n),
}

const app = makeTestApp(
  {},
  {
    clock,
    network: {
      resolve: () => Promise.reject(new Error('Not expected')),
      fetch: async (url, init) => {
        let body = await new Response(init.body).text()
        if (url.href === RESEND) {
          let { to, subject, text } = JSON.parse(body)
          emails.push({ to: to[0], subject, text })
          await resend()
          if (resendFails) return Response.json({ message: 'Unavailable' }, { status: 503 })
          return Response.json({ id: 'sent' })
        }
        let token = new URLSearchParams(body).get('response') ?? ''
        tokens.push(token)
        return Response.json(
          token === 'good-token'
            ? { success: true, hostname: 'example.com' }
            : { success: false, 'error-codes': ['invalid-input-response'] },
        )
      },
    },
  },
)

const commands = <A, E>(run: (commands: SiteConfigCommands['Service']) => Effect.Effect<A, E>) =>
  app.run(Effect.flatMap(SiteConfigCommands, run))
const setUpEmail = () =>
  commands((commands) =>
    commands.saveEmail({
      provider: 'resend',
      fromName: 'Test Site',
      from: 'news@example.com',
      replyTo: '',
      sesRegion: '',
      sesEndpoint: '',
      sesAccessKeyId: '',
      sesSecretAccessKey: '',
      resendApiKey: 're_test_key_abcd1234',
    }),
  )
const setUpTurnstile = (enabled = true) =>
  commands((commands) =>
    commands.saveTurnstile({ siteKey: SITE_KEY, secretKey: '0x4AAAAAAAsecretKey456789' }, enabled),
  )
const open = async () => {
  await setUpEmail()
  await setUpTurnstile()
  await commands((commands) => commands.saveSubscriptions(true))
}

const sql = <A extends object>(
  run: (sql: SqlClient.SqlClient) => Effect.Effect<readonly A[], unknown>,
) => app.run(Effect.flatMap(SqlClient.SqlClient, run).pipe(Effect.orDie))
const users = () =>
  sql(
    (sql) => sql<{ name: string; email: string; email_verified: number }>`
    select name, email, email_verified from users`,
  )
const codeRows = () =>
  sql(
    (sql) =>
      sql<{ identifier: string; value: string }>`select identifier, value from verifications`,
  )

const post = (path: string, fields: Record<string, string>, cookie?: string) =>
  app.fetch(path, {
    method: 'POST',
    headers: cookie ? { Cookie: cookie } : {},
    body: new URLSearchParams(fields),
  })
const codeCookie = (response: Response) =>
  response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith('sign_up='))
    ?.split(';')[0]
const lastCode = () => capture(defined(emails.at(-1), 'an email').text, /\n\n(\d{6})\n\n/)

// Asks for a code, half a minute after the last one, returning the cookie that says for which
// address.
const askForCode = async (fields: Record<string, string> = {}) => {
  later(30_000)
  let response = await post('/subscribe', {
    name: 'Ada Lovelace',
    email: 'Ada@Example.com',
    'cf-turnstile-response': 'good-token',
    ...fields,
  })
  expect(response.status).toBe(303)
  return defined(codeCookie(response), 'the code’s cookie')
}
const enter = (code: string, cookie: string) => post('/subscribe/verify', { code }, cookie)

beforeEach(async () => {
  await app.seedDatabase()
  emails = []
  tokens = []
  resend = () => Promise.resolve()
  resendFails = false
})
afterAll(app.dispose)

describe('while subscribing is closed', () => {
  it('shows no Subscribe button, and says so at /subscribe', async () => {
    await setUpEmail()
    await setUpTurnstile()
    let home = await (await app.fetch('/')).text()
    expect(home).not.toContain('href="/subscribe"')
    for (let response of [
      await app.fetch('/subscribe'),
      await app.fetch('/subscribe/verify'),
      await post('/subscribe', { name: 'Ada', email: 'ada@example.com' }),
    ]) {
      expect(response.status).toBe(404)
      expect(await response.text()).toContain('Test Site isn’t taking subscribers right now.')
    }
    expect(tokens).toEqual([])
  })

  it('is paused while Turnstile is off, though the switch is on', async () => {
    await open()
    let cookie = await askForCode()
    await setUpTurnstile(false)
    expect(await (await app.fetch('/')).text()).not.toContain('href="/subscribe"')
    let response = await enter(lastCode(), cookie)
    expect(response.status).toBe(404)
    expect(await users()).toEqual([])
  })
})

describe('subscribing', () => {
  beforeEach(open)

  it('starts at the home page’s Subscribe button, below the introduction', async () => {
    let home = await (await app.fetch('/')).text()
    expect(home).toMatch(
      /<p>I check that things work.<\/p><a data-slot="button"[^>]* href="\/subscribe">Subscribe<\/a><\/section>/,
    )
  })

  it('asks for a name and an address, with Turnstile’s widget, kept out of caches and search', async () => {
    let response = await app.fetch('/subscribe')
    let html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toContain('<h1 class="page-title">Subscribe to Test Site</h1>')
    expect(html).toMatch(/<input[^>]* name="name"[^>]* autocomplete="name"/)
    expect(html).toMatch(/<input[^>]* name="email"[^>]* type="email"/)
    expect(html).toContain(`data-sitekey="${SITE_KEY}"`)
    expect(html).toContain('<meta name="robots" content="noindex">')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Content-Security-Policy')).toContain(
      'frame-src https://challenges.cloudflare.com',
    )
  })

  it('emails a code, with the address sealed in a cookie, and the code’s hash in the database', async () => {
    let response = await post('/subscribe', {
      name: 'Ada Lovelace',
      email: 'Ada@Example.com',
      'cf-turnstile-response': 'good-token',
    })
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe('/subscribe/verify')
    let cookie = response.headers.getSetCookie().find((cookie) => cookie.startsWith('sign_up='))
    expect(cookie).toMatch(
      /^sign_up=v1\.[\w-]{16}\.[\w-]+; Max-Age=600; Path=\/subscribe; HttpOnly; SameSite=Lax$/,
    )
    expect(cookie).not.toContain('ada')
    expect(tokens).toEqual(['good-token'])

    let [email] = emails
    let code = lastCode()
    expect(email?.to).toBe('ada@example.com')
    expect(email?.subject).toBe(`${code} is your code to subscribe to Test Site`)
    expect(email?.text).toContain('Hi Ada Lovelace,')
    expect(email?.text).toContain('It expires in 10 minutes.')

    let [row] = await codeRows()
    expect(row?.identifier).toBe('sign-up-otp-ada@example.com')
    let value = JSON.parse(defined(row, 'the code’s row').value)
    expect(value).toEqual({ code: expect.any(String), name: 'Ada Lovelace', attempts: 0 })
    expect(value.code).not.toContain(code)

    let page = await app.fetch('/subscribe/verify', {
      headers: { Cookie: defined(codeCookie(response), 'a cookie') },
    })
    let html = await page.text()
    expect(page.status).toBe(200)
    expect(html).toContain('We sent a 6-digit code to ada@example.com.')
    expect(html).toMatch(/<input[^>]* autocomplete="one-time-code"[^>]* name="code"/)
  })

  it('makes the account for the right code, and emails that they’re subscribed', async () => {
    let cookie = await askForCode()
    let code = lastCode()
    // As pasted, with spaces.
    let response = await enter(` ${code.slice(0, 3)} ${code.slice(3)} `, cookie)
    let html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toContain('<h1 class="page-title">You’re subscribed</h1>')
    expect(html).toContain(
      'Thanks, Ada Lovelace. You’re subscribed to Test Site as ada@example.com.',
    )
    expect(response.headers.getSetCookie()).toContainEqual(
      expect.stringMatching(/^sign_up=;.*Max-Age=0/),
    )
    expect(await users()).toEqual([
      { name: 'Ada Lovelace', email: 'ada@example.com', email_verified: 1 },
    ])
    expect(await codeRows()).toEqual([])
    expect(emails.at(-1)).toEqual({
      to: 'ada@example.com',
      subject: 'You’re subscribed to Test Site',
      text: 'Hi Ada Lovelace,\n\nYou’re now subscribed to Test Site (https://example.com), as ada@example.com.\n',
    })
    // A code works once.
    expect((await enter(code, cookie)).status).toBe(410)
  })

  it('allows three wrong codes, then needs a new one', async () => {
    let cookie = await askForCode()
    let code = lastCode()
    let wrong = code === '000000' ? '111111' : '000000'
    let first = await enter(wrong, cookie)
    expect(first.status).toBe(400)
    expect(await first.text()).toContain('That code isn’t right. You can try 2 more times.')
    expect(await (await enter(wrong, cookie)).text()).toContain('You can try 1 more time.')
    let last = await enter(wrong, cookie)
    expect(last.status).toBe(410)
    expect(await last.text()).toContain('Too many wrong codes')
    expect((await enter(code, cookie)).status).toBe(410)
    expect(await users()).toEqual([])
  })

  it('needs the last code sent, in time, in the browser that asked for it', async () => {
    let cookie = await askForCode()
    let first = lastCode()
    await askForCode()
    let replaced = await enter(first, cookie)
    expect(replaced.status).toBe(400)
    expect(await replaced.text()).toContain('That code isn’t right.')
    expect((await enter(lastCode(), 'sign_up=v1.someone-elses.cookie')).status).toBe(410)
    expect((await post('/subscribe/verify', { code: lastCode() })).status).toBe(410)

    await sql((sql) => sql`update verifications set expires_at = '2000-01-01T00:00:00.000Z'`)
    let expired = await enter(lastCode(), cookie)
    expect(expired.status).toBe(410)
    expect(await expired.text()).toContain('Your code expired')
    expect((await app.fetch('/subscribe/verify', { headers: { Cookie: cookie } })).status).toBe(410)
    expect(await users()).toEqual([])
  })

  it('treats an address with an account as any other, keeping the account as it is', async () => {
    let cookie = await askForCode()
    expect((await enter(lastCode(), cookie)).status).toBe(200)
    cookie = await askForCode({ name: 'Someone Else' })
    let response = await enter(lastCode(), cookie)
    expect(response.status).toBe(200)
    expect(await users()).toEqual([
      { name: 'Ada Lovelace', email: 'ada@example.com', email_verified: 1 },
    ])
  })

  it('refuses a form without a name or address, before asking Cloudflare', async () => {
    let response = await post('/subscribe', {
      name: '',
      email: 'not-an-address',
      'cf-turnstile-response': 'good-token',
    })
    let html = await response.text()
    expect(response.status).toBe(400)
    expect(html).toContain('Enter your name')
    expect(html).toContain('Expected an email address, like you@example.com')
    expect(html).toContain('value="not-an-address"')
    expect(tokens).toEqual([])
    expect(emails).toEqual([])
  })

  it('refuses a form that didn’t pass Turnstile, sending nothing', async () => {
    let fields = { name: 'Ada', email: 'ada@example.com' }
    let missing = await post('/subscribe', fields)
    expect(missing.status).toBe(400)
    expect(await missing.text()).toContain(
      'Complete the check that you’re human, then subscribe again.',
    )
    let denied = await post('/subscribe', { ...fields, 'cf-turnstile-response': 'bad-token' })
    expect(denied.status).toBe(400)
    expect(await denied.text()).toContain('The check that you’re human didn’t pass.')
    expect(emails).toEqual([])
    expect(await codeRows()).toEqual([])
  })
})

describe('how often codes are sent', () => {
  beforeEach(open)

  const ask = () =>
    post('/subscribe', {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      'cf-turnstile-response': 'good-token',
    })

  it('sends an address a code at most every 30 seconds, and 5 an hour', async () => {
    expect((await ask()).status).toBe(303)
    later(20_000)
    let soon = await ask()
    expect(soon.status).toBe(429)
    expect(await soon.text()).toContain(
      'A code was just sent to this address. You can ask for another in 10 seconds.',
    )
    // Another address isn't held up.
    expect((await askForCode({ email: 'grace@example.com' })).length).toBeGreaterThan(0)
    for (let sent = 1; sent < 5; sent++) {
      later(30_000)
      expect((await ask()).status).toBe(303)
    }
    later(30_000)
    let tooMany = await ask()
    expect(tooMany.status).toBe(429)
    expect(await tooMany.text()).toContain(
      'Too many codes were sent to this address. You can ask for another in 60 minutes.',
    )
    expect(emails.filter((email) => email.to === 'ada@example.com')).toHaveLength(5)
    later(60 * 60 * 1000)
    expect((await ask()).status).toBe(303)
  })

  it('keeps the last code if a new one can’t be sent', async () => {
    let cookie = await askForCode()
    let code = lastCode()
    resendFails = true
    later(30_000)
    let failed = await ask()
    expect(failed.status).toBe(502)
    expect(await failed.text()).toContain('We couldn’t send the email with your code.')
    expect(codeCookie(failed)).toBeUndefined()
    expect((await enter(code, cookie)).status).toBe(200)
  })

  it('keeps the newest code when an older request finishes last', async () => {
    let release = () => {}
    resend = () => new Promise((resolve) => (release = resolve))
    let older = ask()
    await Promise.resolve()
    while (emails.length === 0) await new Promise((resolve) => setImmediate(resolve))
    resend = () => Promise.resolve()
    let newer = await askForCode()
    let newest = lastCode()
    release()
    let olderCookie = defined(codeCookie(await older), 'the older request’s cookie')
    expect((await enter(newest, olderCookie)).status).toBe(200)
    expect(newer.length).toBeGreaterThan(0)
  })
})
