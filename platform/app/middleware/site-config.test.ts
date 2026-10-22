import * as assert from 'remix/assert'
import { beforeAll, describe, it } from 'remix/test'

import { getSavedSiteConfig, isSiteConfigured } from '../data/config.ts'
import { migrateDatabase } from '../data/db.ts'
import { routes } from '../routes.ts'
import { fetch, logInAdmin, sessionCookie } from '../../test/client.ts'
import { TEST_SITE_CONFIG } from '../../test/seed.ts'

async function adminCookie() {
  return sessionCookie(await logInAdmin())!
}

// A fresh database, with none of the site's settings saved: each test file has its own.
beforeAll(async () => {
  await migrateDatabase()
})

describe('a site that isn’t configured', () => {
  it('sends public pages to the admin login', async () => {
    for (let path of [routes.home.href(), '/posts/abcdefghij', '/no-such-page']) {
      let response = await fetch(path)
      assert.equal(response.status, 302, path)
      assert.equal(response.headers.get('Location'), routes.admin.login.href())
      assert.equal(response.headers.get('Cache-Control'), 'no-store')
    }
  })

  it('says the feeds and other files for machines aren’t available', async () => {
    for (let route of [routes.rss, routes.sitemap, routes.robots, routes.manifest]) {
      let response = await fetch(route.href())
      assert.equal(response.status, 503, route.href())
    }
  })

  it('still serves the admin login, with its assets, icons, and fonts', async () => {
    let login = await fetch(routes.admin.login.href())
    let html = await login.text()
    assert.equal(login.status, 200)
    assert.match(html, /<title>Log in · LogSpace<\/title>/)
    assert.match(html, /<header[^]*>LogSpace<\/span><\/a>[^]*<\/header>/)
    // The feed isn't there yet.
    assert.doesNotMatch(html, /rss\.xml/)

    let entry = html.match(/"entry":"(\/assets\/[^"]+)"/)
    assert.ok(entry, 'the page loads its scripts')
    for (let path of [
      entry[1],
      routes.favicon.href(),
      routes.appleTouchIcon.href(),
      routes.siteFile.href({ file: 'icon-192.png' }),
      '/fonts/instrument-sans-latin-600.woff2',
    ]) {
      assert.equal((await fetch(path)).status, 200, path)
    }
  })

  it('sends the admin to /admin/config, where the site URL is filled in', async () => {
    let cookie = await adminCookie()
    let admin = await fetch(routes.admin.index.href(), { headers: { Cookie: cookie } })
    assert.equal(admin.status, 302)
    assert.equal(admin.headers.get('Location'), routes.admin.config.index.href())

    let page = await fetch(routes.admin.config.index.href(), { headers: { Cookie: cookie } })
    let html = await page.text()
    assert.equal(page.status, 200)
    assert.match(html, /<title>Configure Site · LogSpace<\/title>/)
    assert.match(html, /Set the site’s title, URL, and description to finish setting it up/)
    assert.match(html, /<input [^>]*name="siteTitle"[^>]* value=""/)
    assert.match(html, /<input [^>]*name="siteUrl"[^>]* value="http:\/\/localhost"/)
    assert.match(html, /<input [^>]*name="heroHeading"[^>]* value="Hello, world!"/)
  })

  it('is public once its required settings are saved', async () => {
    let cookie = await adminCookie()
    let { siteTitle, siteUrl, siteDescription } = TEST_SITE_CONFIG
    let save = await fetch(routes.admin.config.action.href(), {
      method: 'POST',
      headers: { Cookie: cookie },
      body: new URLSearchParams({ siteTitle, siteUrl, siteDescription }),
    })
    assert.equal(save.status, 303)
    assert.ok(isSiteConfigured())
    assert.equal(getSavedSiteConfig().siteTitle, siteTitle)

    let home = await fetch(routes.home.href())
    assert.equal(home.status, 200)
    assert.match(await home.text(), /<title>Test Site<\/title>/)
    assert.equal((await fetch(routes.rss.href())).status, 200)
    let admin = await fetch(routes.admin.index.href(), { headers: { Cookie: cookie } })
    assert.equal(admin.status, 200)
  })
})
