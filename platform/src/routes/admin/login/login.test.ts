// Logging in and out.
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { Effect } from 'effect'

import { defined, makeTestApp } from '../../../../test/app.ts'
import { PostQueries } from '../../../data/posts/queries.ts'

const app = makeTestApp()
const posts = () => app.run(Effect.flatMap(PostQueries, (queries) => queries.all))

// Saving a post removes the files it doesn't name, so each test starts with all of them.
beforeEach(async () => {
  await app.seedDatabase()
  await app.seedMedia()
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
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex')
  })

  it('rejects a wrong password, without a session cookie', async () => {
    let response = await app.logIn('not-the-password')
    expect(response.status).toBe(401)
    expect(await response.text()).toMatch(/That password isn’t right/)
    expect(app.sessionCookie(response)).toBeUndefined()
  })

  it('shows every post once logged in, and logging out ends the session', async () => {
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
    for (let post of await posts()) expect(html).toContain(`href="/posts/${post.id}"`)
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
