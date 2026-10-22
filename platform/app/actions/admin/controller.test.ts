import * as assert from 'remix/assert'
import { beforeAll, describe, it } from 'remix/test'

import { fetch, logInAdmin, sessionCookie } from '../../../test/client.ts'
import { seedDatabase } from '../../../test/seed.ts'
import { getPosts } from '../../data/posts/store.ts'
import { routes } from '../../routes.ts'

beforeAll(seedDatabase)

describe('admin controller', () => {
  it('GET /admin sends visitors who are not logged in as admin to the login page', async () => {
    let response = await fetch(routes.admin.index.href())
    assert.equal(response.status, 302)
    assert.equal(response.headers.get('Location'), routes.admin.login.href())
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
  })

  it('GET /admin/login shows a password form', async () => {
    let response = await fetch(routes.admin.login.href())
    let html = await response.text()
    assert.equal(response.status, 200)
    assert.match(html, /<input [^>]*type="password"/)
    assert.match(html, /<meta [^>]*name="robots" content="noindex"/)
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex')
  })

  it('POST /admin/login rejects a wrong password', async () => {
    let response = await logInAdmin('not-the-password')
    assert.equal(response.status, 401)
    assert.match(await response.text(), /That password isn’t right/)

    // No session cookie at all, so nothing from this attempt can open /admin.
    assert.equal(sessionCookie(response), undefined)
  })

  it('admin login shows every post, and admin logout ends the session', async () => {
    let response = await logInAdmin()
    assert.equal(response.status, 302)
    assert.equal(response.headers.get('Location'), routes.admin.index.href())

    let setCookie = response.headers.getSetCookie().join('\n')
    assert.match(setCookie, /HttpOnly/i)
    assert.match(setCookie, /SameSite=Lax/i)
    assert.match(setCookie, /Path=\/admin/i)

    let cookie = sessionCookie(response)!
    let page = await fetch(routes.admin.index.href(), { headers: { Cookie: cookie } })
    let html = await page.text()
    assert.equal(page.status, 200)
    assert.match(html, /<header[^]*aria-label="Log out"[^]*<\/header>/)
    for (let post of await getPosts()) {
      assert.match(html, new RegExp(`href="/posts/${post.id}"`))
    }

    let adminLogout = await fetch(routes.admin.logout.href(), {
      method: 'POST',
      headers: { Cookie: cookie },
    })
    assert.equal(adminLogout.status, 302)
    let cleared = sessionCookie(adminLogout)
    let after = await fetch(routes.admin.index.href(), {
      headers: cleared ? { Cookie: cleared } : {},
    })
    assert.equal(after.status, 302)
  })

  it('rejects a tampered session cookie', async () => {
    let cookie = sessionCookie(await logInAdmin())!
    let tampered = cookie.slice(0, -2) + (cookie.endsWith('A') ? 'BB' : 'AA')
    let page = await fetch(routes.admin.index.href(), { headers: { Cookie: tampered } })
    assert.equal(page.status, 302)
  })

  it('rejects admin logins posted from other sites', async () => {
    let response = await logInAdmin(undefined, { 'Sec-Fetch-Site': 'cross-site' })
    assert.equal(response.status, 403)
    assert.equal(sessionCookie(response), undefined)
  })
})
