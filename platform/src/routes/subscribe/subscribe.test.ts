// Subscribing: the home page's button, the form with Turnstile, the code emailed (with Resend,
// which a fake network answers for, as it does for Cloudflare), and the account it makes. Then
// unsubscribing, by the link in the email that says they're subscribed.
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
let emails: {
  to: string
  subject: string
  text: string
  headers?: Record<string, string>
}[] = []
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
          let { to, subject, text, headers } = JSON.parse(body)
          emails.push({ to: to[0], subject, text, ...(headers ? { headers } : {}) })
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
const setUpEmail = (hourlyLimit = '1000') =>
  commands((commands) =>
    commands.saveEmail({
      provider: 'resend',
      fromName: 'Test Site',
      from: 'news@example.com',
      replyTo: '',
      hourlyLimit,
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

const post = (path: string, fields: Record<string, string>) =>
  app.fetch(path, { method: 'POST', body: new URLSearchParams(fields) })
const lastCode = () => capture(defined(emails.at(-1), 'an email').text, /\n\n(\d{6})\n\n/)

// Asks for a code for Ada.
const ask = (fields: Record<string, string> = {}) =>
  post('/subscribe', {
    name: 'Ada Lovelace',
    email: 'Ada@Example.com',
    'cf-turnstile-response': 'good-token',
    ...fields,
  })
// Asks for a code, half a minute after the last one, returning the page to enter it at.
const askForCode = async (fields: Record<string, string> = {}) => {
  later(30_000)
  let response = await ask(fields)
  expect(response.status).toBe(303)
  return defined(response.headers.get('Location'), 'the code’s page')
}
const enter = (code: string, page: string) => post(page, { code })

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
      await app.fetch('/subscribe/verify/some-code'),
      await post('/subscribe', { name: 'Ada', email: 'ada@example.com' }),
    ]) {
      expect(response.status).toBe(404)
      expect(await response.text()).toContain('Test Site isn’t taking subscribers right now.')
    }
    expect(tokens).toEqual([])
  })

  it('is paused while Turnstile is off, though the switch is on', async () => {
    await open()
    let page = await askForCode()
    await setUpTurnstile(false)
    expect(await (await app.fetch('/')).text()).not.toContain('href="/subscribe"')
    let response = await enter(lastCode(), page)
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

  it('emails a code, entered at a page by its random id, with its hash in the database', async () => {
    let response = await ask()
    expect(response.status).toBe(303)
    let page = defined(response.headers.get('Location'), 'the code’s page')
    expect(page).toMatch(/^\/subscribe\/verify\/[0-9a-f-]{36}$/)
    expect(response.headers.getSetCookie()).toEqual([])
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

    let shown = await app.fetch(page)
    let html = await shown.text()
    expect(shown.status).toBe(200)
    expect(shown.headers.get('Cache-Control')).toBe('no-store')
    expect(html).toContain('We sent a 6-digit code to ada@example.com.')
    expect(html).toContain(`<form method="post" action="${page}">`)
    expect(html).toMatch(/<input[^>]* autocomplete="one-time-code"[^>]* name="code"/)
  })

  it('makes the account for the right code, and emails that they’re subscribed', async () => {
    let page = await askForCode()
    let code = lastCode()
    // As pasted, with spaces.
    let response = await enter(` ${code.slice(0, 3)} ${code.slice(3)} `, page)
    let html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toContain('<h1 class="page-title">You’re subscribed</h1>')
    expect(html).toContain(
      'Thanks, Ada Lovelace. You’re subscribed to Test Site as ada@example.com.',
    )
    expect(await users()).toEqual([
      { name: 'Ada Lovelace', email: 'ada@example.com', email_verified: 1 },
    ])
    expect(await codeRows()).toEqual([])
    let email = defined(emails.at(-1), 'an email')
    let link = capture(email.text, /To unsubscribe: (\S+)\n$/)
    expect(link).toMatch(/^https:\/\/example\.com\/unsubscribe\/[\w-]{36}\/[\w-]{22}$/)
    expect(email).toEqual({
      to: 'ada@example.com',
      subject: 'You’re subscribed to Test Site',
      text:
        'Hi Ada Lovelace,\n\nYou’re now subscribed to Test Site (https://example.com), as ada@example.com.\n\n' +
        `To unsubscribe: ${link}\n`,
      headers: {
        'List-Unsubscribe': `<${link}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    })
    // A code works once.
    expect((await enter(code, page)).status).toBe(410)
  })

  it('allows three wrong codes, then needs a new one', async () => {
    let page = await askForCode()
    let code = lastCode()
    let wrong = code === '000000' ? '111111' : '000000'
    let first = await enter(wrong, page)
    expect(first.status).toBe(400)
    expect(await first.text()).toContain('That code isn’t right. You can try 2 more times.')
    expect(await (await enter(wrong, page)).text()).toContain('You can try 1 more time.')
    let last = await enter(wrong, page)
    expect(last.status).toBe(410)
    expect(await last.text()).toContain('Too many wrong codes')
    expect((await enter(code, page)).status).toBe(410)
    expect(await users()).toEqual([])
  })

  it('takes each code at its own page, until it expires', async () => {
    let first = await askForCode()
    let firstCode = lastCode()
    let second = await askForCode()
    let secondCode = lastCode()
    let mixed = await enter(secondCode, first)
    expect(mixed.status).toBe(400)
    expect(await mixed.text()).toContain('That code isn’t right.')
    expect((await enter(firstCode, '/subscribe/verify/not-a-code')).status).toBe(410)
    expect((await app.fetch('/subscribe/verify/not-a-code')).status).toBe(410)

    await sql((sql) => sql`update verifications set expires_at = '2000-01-01T00:00:00.000Z'`)
    let expired = await enter(firstCode, first)
    expect(expired.status).toBe(410)
    expect(await expired.text()).toContain('Your code expired')
    expect((await app.fetch(second)).status).toBe(410)
    expect(await users()).toEqual([])
  })

  it('treats an address with an account as any other, keeping the account as it is', async () => {
    let page = await askForCode()
    expect((await enter(lastCode(), page)).status).toBe(200)
    page = await askForCode({ name: 'Someone Else' })
    let response = await enter(lastCode(), page)
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

  it('sends an address a code at most every 30 seconds, and 5 an hour', async () => {
    expect((await ask()).status).toBe(303)
    later(20_000)
    let soon = await ask()
    expect(soon.status).toBe(429)
    expect(await soon.text()).toContain(
      'A code was just requested for this address. You can ask for another in 10 seconds.',
    )
    // Another address isn't held up.
    await askForCode({ email: 'grace@example.com' })
    for (let sent = 1; sent < 5; sent++) {
      later(30_000)
      expect((await ask()).status).toBe(303)
    }
    later(30_000)
    let tooMany = await ask()
    expect(tooMany.status).toBe(429)
    expect(await tooMany.text()).toContain(
      'Too many codes were requested for this address. You can ask for another in 60 minutes.',
    )
    expect(emails.filter((email) => email.to === 'ada@example.com')).toHaveLength(5)
    later(60 * 60 * 1000)
    expect((await ask()).status).toBe(303)
  })

  it('sends no code past the site’s emails an hour, until the hour is up', async () => {
    await setUpEmail('2')
    await askForCode()
    await askForCode({ email: 'grace@example.com' })
    let limited = await ask({ email: 'alan@example.com' })
    expect(limited.status).toBe(503)
    expect(await limited.text()).toContain(
      'We can’t send any more emails right now. Try again in 60 minutes.',
    )
    expect(emails).toHaveLength(2)
    later(60 * 60 * 1000)
    await askForCode({ email: 'alan@example.com' })
    expect(emails.at(-1)?.to).toBe('alan@example.com')
  })

  it('keeps the last code if a new one can’t be sent, or isn’t sent yet', async () => {
    let page = await askForCode()
    let code = lastCode()
    resendFails = true
    later(30_000)
    let failed = await ask()
    expect(failed.status).toBe(502)
    expect(await failed.text()).toContain('We couldn’t send the email with your code.')
    expect(await codeRows()).toHaveLength(1)

    // While a new one is being sent, the last one still works.
    resendFails = false
    let release = () => {}
    resend = () => new Promise((resolve) => (release = resolve))
    later(30_000)
    let sending = ask()
    while (emails.length < 3) await new Promise((resolve) => setImmediate(resolve))
    resend = () => Promise.resolve()
    expect((await enter(code, page)).status).toBe(200)
    release()
    await sending
  })

  it('leaves a code alone, whatever is done at another code’s page', async () => {
    // A page kept from a day-old code for Ada's address.
    let kept = await askForCode()
    later(24 * 60 * 60 * 1000)
    let page = await askForCode()
    let code = lastCode()
    // Someone else asking for a code for her address doesn't replace hers.
    let other = await askForCode()
    let wrong = code === '000000' ? '111111' : '000000'
    for (let page of [kept, kept, kept, other, other, other]) {
      expect((await enter(wrong, page)).status).not.toBe(200)
    }
    expect((await enter(code, page)).status).toBe(200)
  })

  it('sends each of two requests that overlap to its own page, which works', async () => {
    let release = () => {}
    resend = () => new Promise((resolve) => (release = resolve))
    let older = ask()
    while (emails.length === 0) await new Promise((resolve) => setImmediate(resolve))
    resend = () => Promise.resolve()
    let newer = await askForCode()
    let newerCode = lastCode()
    release()
    let olderPage = defined((await older).headers.get('Location'), 'the older request’s page')
    expect(olderPage).not.toBe(newer)
    expect((await app.fetch(olderPage)).status).toBe(200)
    expect((await enter(newerCode, newer)).status).toBe(200)
  })
})

describe('unsubscribing', () => {
  // Subscribes Ada, returning the path of the link to unsubscribe in the email that says so.
  const subscribed = async () => {
    await open()
    let page = await askForCode()
    expect((await enter(lastCode(), page)).status).toBe(200)
    let text = defined(emails.at(-1), 'an email').text
    return new URL(capture(text, /To unsubscribe: (\S+)/)).pathname
  }

  it('asks first, kept out of caches and search, then unsubscribes when its button is pressed', async () => {
    let link = await subscribed()
    let response = await app.fetch(link)
    let html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toContain('Stop emailing new posts from Test Site to ada@example.com?')
    expect(html).toContain(`<form method="post" action="${link}" class="subscribe-actions">`)
    expect(html).toMatch(/<a data-slot="button" data-variant="outline"[^>]* href="\/">Cancel<\/a>/)
    expect(html).toContain('<meta name="robots" content="noindex">')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    // Opening the link, as an email app's scanner does, leaves them subscribed.
    expect(await users()).toHaveLength(1)

    // The button posts it from the page.
    response = await app.fetch(link, {
      method: 'POST',
      headers: { 'Sec-Fetch-Site': 'same-origin' },
    })
    expect(response.status).toBe(200)
    html = await response.text()
    expect(html).toContain('You won’t get emails from Test Site any more.')
    expect(html).toMatch(
      /<a data-slot="button" data-variant="default"[^>]* href="\/">Back to Home<\/a>/,
    )
    expect(html).toMatch(
      /<a data-slot="button" data-variant="outline"[^>]* href="\/subscribe">Subscribe again<\/a>/,
    )
    expect(await users()).toEqual([])
    // Opened again, the link says so.
    expect(await (await app.fetch(link)).text()).toContain(
      '<h1 class="page-title">You’re unsubscribed</h1>',
    )
  })

  it('takes an email app’s one-click post, again and again, while subscribing is closed', async () => {
    let link = await subscribed()
    await commands((commands) => commands.saveSubscriptions(false))
    // As Gmail's servers post it (RFC 8058), not from a page.
    for (let attempt of [1, 2]) {
      let response = await post(link, { 'List-Unsubscribe': 'One-Click' })
      expect(response.status, `attempt ${attempt}`).toBe(200)
      // Subscribing again isn't offered while it's closed.
      expect(await response.text()).not.toContain('Subscribe again')
    }
    expect(await users()).toEqual([])
  })

  it('refuses a link the site didn’t make, leaving everyone subscribed', async () => {
    let link = await subscribed()
    let [, , id = '', signature = ''] = link.split('/')
    let otherId = crypto.randomUUID()
    for (let wrong of [
      `/unsubscribe/${id}/${signature.slice(0, -1)}`,
      `/unsubscribe/${id}/${'A'.repeat(22)}`,
      `/unsubscribe/${otherId}/${signature}`,
    ]) {
      for (let response of [await app.fetch(wrong), await post(wrong, {})]) {
        expect(response.status, wrong).toBe(404)
        expect(await response.text()).toContain('<h1 class="page-title">This link isn’t right</h1>')
      }
    }
    expect(await users()).toHaveLength(1)
  })
})
