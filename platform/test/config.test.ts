// The site's settings: /admin/config, the site's images, and the gate in front of a site that
// isn't set up yet.
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'
import sharp from 'sharp'

import { isSiteConfigured } from '../src/domain/site.ts'
import { SiteConfigQueries } from '../src/queries/site-config.ts'
import { makeTestApp } from './app.ts'
import { TEST_SITE_CONFIG } from './seed.ts'

const app = makeTestApp()
const savedConfig = () => app.run(Effect.flatMap(SiteConfigQueries, (queries) => queries.saved))
const sql = <A extends object>(
  run: (sql: SqlClient.SqlClient) => Effect.Effect<readonly A[], unknown>,
) => app.run(Effect.flatMap(SqlClient.SqlClient, run).pipe(Effect.orDie))

beforeEach(app.seedDatabase)
afterAll(app.dispose)

const save = (body: URLSearchParams | FormData, headers?: HeadersInit) =>
  app.adminFetch('/admin/config', { method: 'POST', headers, body })
const configForm = (fields: Record<string, string> = {}) =>
  new URLSearchParams({ ...TEST_SITE_CONFIG, ...fields })

// The config form with images, as the browser sends it.
function imageForm(files: Record<string, File>, fields: Record<string, string> = {}) {
  let form = new FormData()
  for (let [name, value] of Object.entries({ ...TEST_SITE_CONFIG, ...fields }))
    form.set(name, value)
  for (let [name, file] of Object.entries(files)) form.set(name, file)
  return form
}

async function png(width: number, height: number) {
  let background = { r: 200, g: 40, b: 40, alpha: 1 }
  let data = await sharp({ create: { width, height, channels: 4, background } })
    .png()
    .toBuffer()
  return new File([new Uint8Array(data)], 'image.png', { type: 'image/png' })
}

async function jpeg(width: number, height: number) {
  let background = { r: 40, g: 40, b: 200 }
  let data = await sharp({ create: { width, height, channels: 3, background } })
    .jpeg()
    .toBuffer()
  return new File([new Uint8Array(data)], 'image.jpg', { type: 'image/jpeg' })
}

async function imageSize(response: Response) {
  let { width, height, format } = await sharp(await response.bytes()).metadata()
  return { width, height, format }
}

describe('/admin/config', () => {
  it('needs an admin login', async () => {
    let page = await app.fetch('/admin/config')
    expect(page.status).toBe(302)
    expect(page.headers.get('Location')).toBe('/admin/login')
    let attempt = await app.fetch('/admin/config', {
      method: 'POST',
      body: configForm({ siteTitle: 'Hacked' }),
    })
    expect(attempt.status).toBe(302)
    expect((await savedConfig()).siteTitle).toBe(TEST_SITE_CONFIG.siteTitle)
  })

  it('is linked from /admin and shows the current settings', async () => {
    expect(await (await app.adminFetch('/admin')).text()).toContain('href="/admin/config"')
    let html = await (await app.adminFetch('/admin/config')).text()
    expect(html).toMatch(/<input [^>]*name="siteTitle"[^>]* value="Test Site"/)
    expect(html).toMatch(/<input [^>]*name="siteUrl"[^>]* value="https:\/\/example\.com"/)
  })

  it('saves the settings, which every page then uses', async () => {
    let response = await save(
      configForm({
        siteTitle: '  New Title ',
        siteUrl: 'https://new.example.com/',
        heroHeading: '',
        heroSubheading: 'Line one\r\nline two',
      }),
    )
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe('/admin/config')
    expect(await savedConfig()).toEqual({
      ...TEST_SITE_CONFIG,
      siteTitle: 'New Title',
      siteUrl: 'https://new.example.com',
      heroHeading: '',
      heroSubheading: 'Line one line two',
    })

    // The next page says it was saved, once.
    let flashed = app.sessionCookie(response)!
    let saved = await app.fetch('/admin/config', { headers: { Cookie: flashed } })
    expect(await saved.text()).toMatch(/role="status"[^>]*>Saved\./)
    let afterwards = await app.fetch('/admin/config', {
      headers: { Cookie: app.sessionCookie(saved)! },
    })
    expect(await afterwards.text()).not.toMatch(/Saved\./)

    let home = await (await app.fetch('/')).text()
    expect(home).toMatch(/<title>New Title<\/title>/)
    expect(home).toMatch(/rel="canonical" href="https:\/\/new\.example\.com\/"/)
    expect(home).not.toMatch(/<h1>/)
    expect(home).toMatch(/<p>Line one line two<\/p>/)
    expect(await (await app.fetch('/robots.txt')).text()).toMatch(
      /Sitemap: https:\/\/new\.example\.com\/sitemap\.xml/,
    )

    // It's stored in the database, not just in memory.
    let rows = await sql<{ value: string }>(
      (sql) => sql`select value from config where key = 'siteTitle'`,
    )
    expect(rows[0].value).toBe('New Title')
  })

  it('rejects settings that are missing or invalid, keeping what was typed', async () => {
    for (let [field, value] of [
      ['siteTitle', '  '],
      ['siteDescription', ''],
      ['siteUrl', 'example.com'],
      ['siteUrl', 'https://example.com/blog'],
      ['siteUrl', 'javascript:alert(1)'],
    ]) {
      let response = await save(configForm({ [field]: value, heroHeading: 'Typed heading' }))
      let html = await response.text()
      expect([field, value, response.status]).toEqual([field, value, 400])
      expect(html).toMatch(/role="alert"/)
      expect(html).toMatch(
        new RegExp(
          `<input [^>]*name="${field}"[^>]*aria-invalid="true"|<textarea [^>]*name="${field}"[^>]*aria-invalid="true"`,
        ),
      )
      expect(html).toMatch(/value="Typed heading"/)
    }
    expect(await savedConfig()).toEqual(TEST_SITE_CONFIG)
  })

  it('rejects config forms posted from other sites', async () => {
    let response = await save(configForm({ siteTitle: 'Hacked' }), {
      'Sec-Fetch-Site': 'cross-site',
    })
    expect(response.status).toBe(403)
    expect((await savedConfig()).siteTitle).toBe(TEST_SITE_CONFIG.siteTitle)
  })

  it('picks up a change made in the database by another process, without a restart', async () => {
    expect(await (await app.fetch('/')).text()).toMatch(/<title>Test Site<\/title>/)
    // As if another connection wrote it: data_version changes only for other connections, so this
    // one goes around the app's own bookkeeping by opening a second connection to the same file.
    let other = makeTestApp({ databasePath: `/tmp/logspace2-config-${process.pid}.sqlite` })
    let writer = makeTestApp({ databasePath: `/tmp/logspace2-config-${process.pid}.sqlite` })
    await other.seedDatabase()
    expect(await (await other.fetch('/')).text()).toMatch(/<title>Test Site<\/title>/)
    await writer.run(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql`update config set value = 'Changed Elsewhere' where key = 'siteTitle'`,
      ).pipe(Effect.orDie),
    )
    expect(await (await other.fetch('/')).text()).toMatch(/<title>Changed Elsewhere<\/title>/)
    await other.dispose()
    await writer.dispose()
    for (let suffix of ['', '-wal', '-shm'])
      await Bun.file(`/tmp/logspace2-config-${process.pid}.sqlite${suffix}`)
        .delete()
        .catch(() => {})
  })
})

describe('the site’s images', () => {
  it('without uploads, has LogSpace’s icons, the title in the navbar, and no social image', async () => {
    let favicon = await app.fetch('/favicon.ico')
    expect(favicon.status).toBe(200)
    expect(favicon.headers.get('Content-Type')).toBe('image/x-icon')
    // An ICO file's header.
    expect([...(await favicon.bytes()).subarray(0, 4)]).toEqual([0, 0, 1, 0])
    for (let [file, size] of [
      ['icon-192.png', 192],
      ['icon-512.png', 512],
      ['icon-maskable-512.png', 512],
    ] as const) {
      expect(await imageSize(await app.fetch(`/site/${file}`))).toEqual({
        width: size,
        height: size,
        format: 'png',
      })
    }
    expect(await imageSize(await app.fetch('/apple-touch-icon.png'))).toEqual({
      width: 180,
      height: 180,
      format: 'png',
    })

    let html = await (await app.fetch('/')).text()
    expect(html).toMatch(/<header[^]*>Test Site<\/span><\/a>[^]*<\/header>/)
    expect(html).not.toMatch(/og:image/)
    expect(html).toMatch(/<meta name="twitter:card" content="summary">/)
    let icon = html.match(/<link rel="icon" href="\/favicon\.ico\?v=([0-9a-f]{12})"/)
    expect(icon).not.toBeNull()
    // A URL with the current version is cached for good.
    let versioned = await app.fetch(`/favicon.ico?v=${icon![1]}`)
    expect(versioned.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(favicon.headers.get('Cache-Control')).toBe('public, max-age=3600')
  })

  it('uploads a logo, icon, and social image, which pages use, and removes them', async () => {
    // An SVG that tries to run a script: it's drawn as a PNG, so the script never reaches a page.
    let logo = new File(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100"><script>alert(1)</script>' +
          '<rect width="400" height="100"/></svg>',
      ],
      'logo.svg',
      { type: 'image/svg+xml' },
    )
    let defaultFavicon = await (await app.fetch('/favicon.ico')).bytes()
    let response = await save(
      imageForm(
        { logo, icon: await png(600, 600), socialImage: await jpeg(1600, 840) },
        { socialImageAlt: 'A red card' },
      ),
    )
    expect(response.status).toBe(303)
    let { logo: savedLogo, icon, socialImage } = await savedConfig()
    expect({ ...savedLogo, version: undefined }).toEqual({
      file: 'logo.png',
      width: 640,
      height: 160,
      version: undefined,
    })
    expect(icon?.file).toBe('icon-512.png')
    expect([socialImage?.file, socialImage?.width]).toEqual(['social.jpg', 1200])

    let logoFile = await app.fetch('/site/logo.png')
    expect(logoFile.headers.get('Content-Type')).toBe('image/png')
    expect(await imageSize(logoFile)).toEqual({ width: 640, height: 160, format: 'png' })
    expect(await (await app.fetch('/favicon.ico')).bytes()).not.toEqual(defaultFavicon)
    expect(await imageSize(await app.fetch('/site/social.jpg'))).toEqual({
      width: 1200,
      height: 630,
      format: 'jpeg',
    })

    let html = await (await app.fetch('/')).text()
    expect(html).toMatch(
      new RegExp(
        `<span role="img" aria-label="Test Site"[^>]*mask-image: url\\(&quot;/site/logo\\.png\\?v=${savedLogo!.version}&quot;\\)`,
      ),
    )
    expect(html).toContain(
      `<meta property="og:image" content="https://example.com/site/social.jpg?v=${socialImage!.version}">`,
    )
    expect(html).toContain('<meta property="og:image:alt" content="A red card">')
    expect(html).toContain('<meta property="og:image:width" content="1200">')
    expect(html).toContain(`href="/favicon.ico?v=${icon!.version}"`)
    let manifest = (await (await app.fetch('/site.webmanifest')).json()) as {
      icons: { src: string }[]
    }
    expect(manifest.icons[0].src).toBe(`/site/icon-192.png?v=${icon!.version}`)

    // A PNG stays a PNG, and the JPEG it replaces goes.
    await save(imageForm({ socialImage: await png(1200, 630) }, { socialImageAlt: 'Red' }))
    expect((await savedConfig()).socialImage?.file).toBe('social.png')
    expect((await app.fetch('/site/social.jpg')).status).toBe(404)
    expect((await app.fetch('/site/social.png')).status).toBe(200)

    let removed = imageForm({})
    for (let kind of ['logo', 'icon', 'socialImage']) removed.set(`${kind}Remove`, 'on')
    expect((await save(removed)).status).toBe(303)
    let config = await savedConfig()
    expect([config.logo, config.icon, config.socialImage]).toEqual([
      undefined,
      undefined,
      undefined,
    ])
    expect((await app.fetch('/site/logo.png')).status).toBe(404)
    expect(await (await app.fetch('/favicon.ico')).bytes()).toEqual(defaultFavicon)
  })

  it('puts the home screen icons on the color the icon is, and keeps the rest transparent', async () => {
    // The color of a pixel of one of the site's images, with its alpha.
    let pixel = async (path: string, x: number, y: number) => {
      let { data, info } = await sharp(await (await app.fetch(path)).bytes())
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      let i = (y * info.width + x) * 4
      return [...data.subarray(i, i + 4)]
    }
    type Manifest = { theme_color: string; background_color: string }

    // LogSpace's icon is a dark gray circle.
    let manifest = (await (await app.fetch('/site.webmanifest')).json()) as Manifest
    expect([manifest.theme_color, manifest.background_color]).toEqual(['#161616', '#161616'])

    // A dark blue circle on a transparent background, with a small white mark.
    let svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' +
      '<circle cx="256" cy="256" r="200" fill="#1d3557"/><rect x="226" y="226" width="60" height="60" fill="#fff"/></svg>'
    expect(
      (await save(imageForm({ icon: new File([svg], 'icon.svg', { type: 'image/svg+xml' }) })))
        .status,
    ).toBe(303)
    expect((await savedConfig()).icon?.color).toBe('#1d3557')

    let dark = [0x1d, 0x35, 0x57, 255]
    expect(await pixel('/apple-touch-icon.png', 0, 0)).toEqual(dark)
    expect(await pixel('/site/icon-maskable-512.png', 0, 0)).toEqual(dark)
    expect(await pixel('/site/icon-maskable-512.png', 256, 256)).toEqual([255, 255, 255, 255])
    for (let file of ['icon-192.png', 'icon-512.png'])
      expect((await pixel(`/site/${file}`, 0, 0))[3]).toBe(0)
    let favicon = (await (await app.fetch('/favicon.ico')).bytes()).subarray(22)
    let { data } = await sharp(favicon).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(data[3]).toBe(0)

    manifest = (await (await app.fetch('/site.webmanifest')).json()) as Manifest
    expect([manifest.theme_color, manifest.background_color]).toEqual(['#1d3557', '#1d3557'])
  })

  it('puts an icon with no opaque pixels on white', async () => {
    let data = await sharp({
      create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } },
    })
      .png()
      .toBuffer()
    expect(
      (await save(imageForm({ icon: new File([new Uint8Array(data)], 'icon.png') }))).status,
    ).toBe(303)
    expect((await savedConfig()).icon?.color).toBe('#ffffff')
  })

  it('rejects an upload that isn’t an image, and a social image without alt text', async () => {
    let notImage = new File(['hello'], 'logo.png', { type: 'image/png' })
    let response = await save(imageForm({ logo: notImage, socialImage: await jpeg(1200, 630) }))
    let html = await response.text()
    expect(response.status).toBe(400)
    expect(html).toMatch(/Logo: That file isn’t an image\./)
    expect(html).toMatch(/Social preview image alt text: Describe the social preview image/)
    expect(html).toMatch(/<input [^>]*name="logo"[^>]*aria-invalid="true"/)
    expect(await savedConfig()).toEqual(TEST_SITE_CONFIG)
    expect((await app.fetch('/site/social.jpg')).status).toBe(404)
  })
})

describe('a site that isn’t configured', () => {
  // A fresh database, with none of the site's settings saved.
  const fresh = makeTestApp()
  afterAll(fresh.dispose)

  it('sends public pages to the admin login', async () => {
    for (let path of ['/', '/posts/abcdefghij', '/no-such-page']) {
      let response = await fresh.fetch(path)
      expect([path, response.status, response.headers.get('Location')]).toEqual([
        path,
        302,
        '/admin/login',
      ])
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    }
  })

  it('says the feeds and other files for machines aren’t available', async () => {
    for (let path of ['/rss.xml', '/sitemap.xml', '/robots.txt', '/site.webmanifest']) {
      expect([path, (await fresh.fetch(path)).status]).toEqual([path, 503])
    }
  })

  it('still serves the admin login, with Datastar, the icons, and the fonts', async () => {
    let login = await fresh.fetch('/admin/login')
    let html = await login.text()
    expect(login.status).toBe(200)
    expect(html).toMatch(/<title>Log in · LogSpace<\/title>/)
    expect(html).toMatch(/<header[^]*>LogSpace<\/span><\/a>[^]*<\/header>/)
    // The feed isn't there yet.
    expect(html).not.toMatch(/rss\.xml/)
    let datastar = html.match(/src="(\/assets\/datastar\.[^"]+)"/)![1]
    for (let path of [
      datastar,
      '/favicon.ico',
      '/apple-touch-icon.png',
      '/site/icon-192.png',
      '/fonts/instrument-sans-latin-600.woff2',
    ]) {
      expect([path, (await fresh.fetch(path)).status]).toEqual([path, 200])
    }
  })

  it('sends the admin to /admin/config, where the site URL is filled in', async () => {
    let cookie = fresh.sessionCookie(await fresh.logIn())!
    let admin = await fresh.fetch('/admin', { headers: { Cookie: cookie } })
    expect(admin.status).toBe(302)
    expect(admin.headers.get('Location')).toBe('/admin/config')

    let page = await fresh.fetch('/admin/config', { headers: { Cookie: cookie } })
    let html = await page.text()
    expect(page.status).toBe(200)
    expect(html).toMatch(/<title>Configure Site · LogSpace<\/title>/)
    expect(html).toMatch(/Set the site’s title, URL, and description to finish setting it up/)
    expect(html).toMatch(/<input [^>]*name="siteTitle"[^>]* value=""/)
    expect(html).toMatch(/<input [^>]*name="siteUrl"[^>]* value="http:\/\/localhost"/)
    expect(html).toMatch(/<input [^>]*name="heroHeading"[^>]* value="Hello, world!"/)
  })

  it('is public once its required settings are saved', async () => {
    let cookie = fresh.sessionCookie(await fresh.logIn())!
    let { siteTitle, siteUrl, siteDescription } = TEST_SITE_CONFIG
    let response = await fresh.fetch('/admin/config', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: new URLSearchParams({ siteTitle, siteUrl, siteDescription }),
    })
    expect(response.status).toBe(303)
    let saved = await fresh.run(Effect.flatMap(SiteConfigQueries, (queries) => queries.saved))
    expect(isSiteConfigured(saved)).toBe(true)
    let home = await fresh.fetch('/')
    expect(home.status).toBe(200)
    expect(await home.text()).toMatch(/<title>Test Site<\/title>/)
    expect((await fresh.fetch('/rss.xml')).status).toBe(200)
    expect((await fresh.fetch('/admin', { headers: { Cookie: cookie } })).status).toBe(200)
  })
})

describe('behind a reverse proxy', () => {
  const proxied = makeTestApp({ trustProxy: true })
  afterAll(proxied.dispose)

  it('fills in the site URL with the protocol and host the browser used', async () => {
    let cookie = proxied.sessionCookie(await proxied.logIn())!
    let html = await (
      await proxied.fetch('/admin/config', {
        headers: {
          Cookie: cookie,
          'X-Forwarded-Proto': 'https',
          'X-Forwarded-Host': 'blog.example.com',
        },
      })
    ).text()
    expect(html).toMatch(/<input [^>]*name="siteUrl"[^>]* value="https:\/\/blog\.example\.com"/)
  })

  it('checks forms against the forwarded host', async () => {
    let headers = { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'blog.example.com' }
    expect(
      (await proxied.logIn(undefined, { ...headers, Origin: 'https://blog.example.com' })).status,
    ).toBe(302)
    expect(
      (await proxied.logIn(undefined, { ...headers, Origin: 'http://localhost' })).status,
    ).toBe(403)
  })
})
