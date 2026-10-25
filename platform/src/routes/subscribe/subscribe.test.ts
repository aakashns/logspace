// Subscribing: the home page's button, the form with Turnstile, the code emailed (with Resend,
// which a fake network answers for, as it does for Cloudflare), and the account it makes.
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { capture, defined, makeTestApp } from '../../../test/app.ts'
import { SiteConfigCommands } from '../../data/site/commands.ts'

const SITE_KEY = '0x4AAAAAAAsiteKey123'
const RESEND = 'https://api.resend.com/emails'

// The emails Resend was asked to send, and the tokens Cloudflare was asked about. Cloudflare
// accepts "good-token" and nothing else.
let emails: { to: string; subject: string; text: string }[] = []
let tokens: string[] = []

const app = makeTestApp(
  {},
  {
    network: {
      resolve: () => Promise.reject(new Error('Not expected')),
      fetch: async (url, init) => {
        let body = await new Response(init.body).text()
        if (url.href === RESEND) {
          let { to, subject, text } = JSON.parse(body)
          emails.push({ to: to[0], subject, text })
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

// Asks for a code, returning the cookie that says which.
const askForCode = async (fields: Record<string, string> = {}) => {
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

  it('emails a code, keeping the address out of the URL, and its hash in the database', async () => {
    let response = await post('/subscribe', {
      name: 'Ada Lovelace',
      email: 'Ada@Example.com',
      'cf-turnstile-response': 'good-token',
    })
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe('/subscribe/verify')
    let cookie = response.headers.getSetCookie().find((cookie) => cookie.startsWith('sign_up='))
    expect(cookie).toMatch(
      /^sign_up=[0-9a-f-]{36}; Max-Age=600; Path=\/subscribe; HttpOnly; SameSite=Lax$/,
    )
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

  it('needs the code in time, in the browser that asked for it, and only the newest one', async () => {
    let cookie = await askForCode()
    let first = lastCode()
    let second = await askForCode()
    let expired = await enter(first, cookie)
    expect(expired.status).toBe(410)
    expect(await expired.text()).toContain('Your code expired')
    expect((await enter(lastCode(), 'sign_up=someone-else')).status).toBe(410)
    expect((await post('/subscribe/verify', { code: lastCode() })).status).toBe(410)

    await sql((sql) => sql`update verifications set expires_at = '2000-01-01T00:00:00.000Z'`)
    expect((await enter(lastCode(), second)).status).toBe(410)
    expect((await app.fetch('/subscribe/verify', { headers: { Cookie: second } })).status).toBe(410)
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
