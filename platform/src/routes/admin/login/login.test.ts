// Logging in and out, and Turnstile on the login form, which a fake network answers for.
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { Effect, Redacted } from 'effect'

import { ADMIN_PASSWORD, defined, makeTestApp } from '../../../../test/app.ts'
import { TEST_SITE_CONFIG } from '../../../../test/seed.ts'
import { SiteConfigCommands } from '../../../data/site/commands.ts'
import { TURNSTILE_SECRET_PURPOSE } from '../../../data/site/site.ts'
import { Secrets } from '../../../lib/secrets.ts'

const SITE_KEY = '0x4AAAAAAAsiteKey123'
const SECRET_KEY = '0x4AAAAAAAsecretKey456789'

// The tokens Cloudflare was asked about, and how it answers.
let asked: (string | null)[] = []
let answer: () => Promise<Response> = () => Promise.reject(new Error('No answer set'))
const answerJson = (body: unknown, status = 200) => {
  answer = () => Promise.resolve(Response.json(body, { status }))
}

const app = makeTestApp(
  {},
  {
    network: {
      resolve: () => Promise.reject(new Error('Not expected')),
      fetch: async (_url, init) => {
        asked.push(new URLSearchParams(await new Response(init.body).text()).get('response'))
        return answer()
      },
    },
  },
)

// Saving a post removes the files it doesn't name, so each test starts with all of them.
beforeEach(async () => {
  await app.seedDatabase()
  await app.seedMedia()
  asked = []
  answer = () => Promise.reject(new Error('No answer set'))
})
afterAll(app.dispose)

describe('logging in', () => {
  it('sends visitors who are not logged in as admin from /admin to the login page', async () => {
    let response = await app.fetch('/admin')
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('/admin/login')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('shows a password form, kept out of search results', async () => {
    let response = await app.fetch('/admin/login')
    let html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toMatch(/<input [^>]*type="password"/)
    expect(html).toMatch(/<meta name="robots" content="noindex">/)
    // The admin layout's styles, then the page's own, and no other page's.
    expect(html).toMatch(/\.admin-page\{.*\.login-form\{/s)
    expect(html).not.toMatch(/\.composer\{/)
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex')
  })

  it('rejects a wrong password, without a session cookie', async () => {
    let response = await app.logIn('not-the-password')
    expect(response.status).toBe(401)
    expect(await response.text()).toMatch(/That password isn’t right/)
    expect(app.sessionCookie(response)).toBeUndefined()
  })

  it('shows the admin once logged in, and logging out ends the session', async () => {
    let response = await app.logIn()
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('/admin')
    let setCookie = response.headers.getSetCookie().join('\n')
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/SameSite=Lax/i)
    expect(setCookie).toMatch(/Path=\/admin/i)

    let cookie = defined(app.sessionCookie(response), 'a session cookie')
    let page = await app.fetch('/admin', { headers: { Cookie: cookie } })
    let html = await page.text()
    expect(page.status).toBe(200)
    expect(html).toMatch(/<header[^]*aria-label="Log out"[^]*<\/header>/)
    expect(html).toContain('href="/admin/posts"')
    // Logged in, the login page leads to /admin.
    expect(
      (await app.fetch('/admin/login', { headers: { Cookie: cookie } })).headers.get('Location'),
    ).toBe('/admin')

    let logout = await app.fetch('/admin/logout', {
      method: 'POST',
      headers: { Cookie: cookie },
    })
    expect(logout.status).toBe(302)
    let cleared = app.sessionCookie(logout)
    let after = await app.fetch('/admin', {
      headers: cleared ? { Cookie: cleared } : {},
    })
    expect(after.status).toBe(302)
  })

  it('rejects a tampered session cookie', async () => {
    let cookie = defined(app.sessionCookie(await app.logIn()), 'a session cookie')
    let tampered = cookie.slice(0, -2) + (cookie.endsWith('A') ? 'BB' : 'AA')
    expect((await app.fetch('/admin', { headers: { Cookie: tampered } })).status).toBe(302)
    // Or one made up to look logged in, signed with the wrong secret.
    let forged = `admin_session=${Buffer.from('{"id":"x","auth":"anything"}').toString('base64url')}.c2lnbmF0dXJl`
    expect((await app.fetch('/admin', { headers: { Cookie: forged } })).status).toBe(302)
  })

  it('rejects admin logins posted from other sites', async () => {
    for (let headers of [{ 'Sec-Fetch-Site': 'cross-site' }, { Origin: 'https://evil.example' }]) {
      let response = await app.logIn(undefined, headers)
      expect(response.status).toBe(403)
      expect(app.sessionCookie(response)).toBeUndefined()
    }
    // A browser's own form, or a request from no browser at all, is fine.
    expect((await app.logIn(undefined, { 'Sec-Fetch-Site': 'same-origin' })).status).toBe(302)
    expect((await app.logIn(undefined, { Origin: 'http://localhost' })).status).toBe(302)
  })

  it('is switched off until the password and secret are long enough', async () => {
    let off = makeTestApp({
      adminPassword: (await import('effect')).Redacted.make('short'),
    })
    let html = await (await off.fetch('/admin/login')).text()
    expect(html).toMatch(/Managing the site is switched off/)
    expect((await off.logIn('short')).status).toBe(401)
    await off.dispose()
  })
})

describe('Turnstile on the login form', () => {
  const save = (enabled: boolean) =>
    app.run(
      Effect.flatMap(SiteConfigCommands, (commands) =>
        commands.saveTurnstile({ siteKey: SITE_KEY, secretKey: SECRET_KEY }, enabled),
      ),
    )
  const logIn = (fields: Record<string, string> = {}) =>
    app.fetch('/admin/login', {
      method: 'POST',
      body: new URLSearchParams({ password: ADMIN_PASSWORD, ...fields }),
    })
  const loggedIn = (response: Response) =>
    response.status === 302 && app.sessionCookie(response) !== undefined
  // Why the form was refused, with the widget shown again to complete.
  const refused = async (response: Response) => {
    expect(response.status).toBe(401)
    expect(app.sessionCookie(response)).toBeUndefined()
    let html = await response.text()
    expect(html).toContain(`data-sitekey="${SITE_KEY}"`)
    return html.match(/<div role="alert" data-slot="field-error">([^<]*)<\/div>/)?.[1]
  }
  const MISSING = 'Complete the check that you’re human, then log in again.'
  const DENIED = 'The check that you’re human didn’t pass. Complete it again, then log in.'

  it('isn’t shown or asked about until it’s enabled', async () => {
    for (let setUp of [async () => {}, () => save(false)]) {
      await setUp()
      let response = await app.fetch('/admin/login')
      expect(await response.text()).not.toContain('class="cf-turnstile"')
      expect(response.headers.get('Content-Security-Policy')).not.toContain('cloudflare')
      expect(loggedIn(await logIn())).toBe(true)
      expect(loggedIn(await logIn({ 'cf-turnstile-response': 'token' }))).toBe(true)
    }
    expect(asked).toEqual([])
  })

  it('is shown at full width once enabled, without the form waiting for it', async () => {
    await save(true)
    let response = await app.fetch('/admin/login')
    let html = await response.text()
    expect(html).toContain(
      `<div class="cf-turnstile" data-sitekey="${SITE_KEY}" data-size="flexible" data-ignore>`,
    )
    expect(html).toContain('<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"')
    expect(html).toMatch(/<button[^>]*type="submit"(?![^>]*disabled)[^>]*>\s*Log in/)
    expect(response.headers.get('Content-Security-Policy')).toContain(
      'frame-src https://challenges.cloudflare.com',
    )
  })

  it('logs in only with an answer Cloudflare accepts, checked before the password', async () => {
    await save(true)
    expect(await refused(await logIn())).toBe(MISSING)
    expect(asked).toEqual([])

    answerJson({ success: false, 'error-codes': ['timeout-or-duplicate'] })
    expect(await refused(await logIn({ 'cf-turnstile-response': 'old-token' }))).toBe(DENIED)

    answerJson({ success: true, hostname: 'localhost' })
    let wrong = await logIn({ password: 'not-the-password', 'cf-turnstile-response': 'token' })
    expect(wrong.status).toBe(401)
    expect(await wrong.text()).toContain('That password isn’t right.')
    expect(loggedIn(await logIn({ 'cf-turnstile-response': 'good-token' }))).toBe(true)
    expect(asked).toEqual(['old-token', 'token', 'good-token'])
  })

  it('has no way around it: keys Cloudflare rejects, or Cloudflare out of reach, refuse too', async () => {
    await save(true)
    answerJson({ success: false, 'error-codes': ['invalid-input-secret'] })
    expect(await refused(await logIn({ 'cf-turnstile-response': 'token' }))).toBe(DENIED)
    answerJson({ error: 'down' }, 503)
    expect(await refused(await logIn({ 'cf-turnstile-response': 'token' }))).toBe(DENIED)
    answer = () => Promise.reject(new Error('Offline'))
    expect(await refused(await logIn({ 'cf-turnstile-response': 'token' }))).toBe(DENIED)

    // Nor a secret key that can't be read, as after AUTH_SESSION_SECRET changes.
    let other = makeTestApp({ sessionSecret: Redacted.make('another-session-secret') })
    let sealed = await other.run(
      Effect.flatMap(Secrets, (secrets) => secrets.seal(SECRET_KEY, TURNSTILE_SECRET_PURPOSE)),
    )
    await other.dispose()
    await app.run(
      Effect.flatMap(SiteConfigCommands, (commands) =>
        commands.save({
          ...TEST_SITE_CONFIG,
          turnstile: { siteKey: SITE_KEY, secretKey: sealed, enabled: true },
        }),
      ),
    )
    expect(await refused(await logIn({ 'cf-turnstile-response': 'token' }))).toBe(DENIED)
    expect(asked).toEqual(['token', 'token', 'token'])
  })

  it('needs only the password once it’s turned off again', async () => {
    await save(true)
    await save(false)
    expect(loggedIn(await logIn())).toBe(true)
  })
})
