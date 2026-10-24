// The site's settings: /admin/config, the site's images, and the gate in front of a site that
// isn't set up yet.
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { isSiteConfigured } from '../src/domain/site.ts'
import { SiteConfigQueries } from '../src/queries/site-config.ts'
import { capture, defined, makeTestApp } from './app.ts'
import { TEST_SITE_CONFIG } from './seed.ts'

const app = makeTestApp()
// The parts of site.webmanifest the tests check.
const decodeManifest = Schema.decodeUnknownSync(
  Schema.Struct({
    theme_color: Schema.String,
    background_color: Schema.String,
    icons: Schema.Array(Schema.Struct({ src: Schema.String })),
  }),
)
const manifest = async () => decodeManifest(await (await app.fetch('/site.webmanifest')).json())
const savedConfig = () => app.run(Effect.flatMap(SiteConfigQueries, (queries) => queries.saved))
const sql = <A extends object>(
  run: (sql: SqlClient.SqlClient) => Effect.Effect<readonly A[], unknown>,
) => app.run(Effect.flatMap(SqlClient.SqlClient, run).pipe(Effect.orDie))

beforeEach(app.seedDatabase)
afterAll(app.dispose)

const save = (body: URLSearchParams | FormData, headers: HeadersInit = {}) =>
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

// Test images: a photo from the test content, stretched to the size.
const PHOTO = Bun.file(`${import.meta.dir}/content/posts/t83tytis1i/cover.jpg`)

async function image(format: 'png' | 'jpeg' | 'webp', width: number, height: number) {
  let data = await new Bun.Image(await PHOTO.bytes()).resize(width, height)[format]().bytes()
  return new File([new Uint8Array(data)], `image.${format}`, { type: `image/${format}` })
}
const png = (width: number, height: number) => image('png', width, height)
const jpeg = (width: number, height: number) => image('jpeg', width, height)

async function imageSize(response: Response) {
  let { width, height, format } = await new Bun.Image(await response.bytes()).metadata()
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
    let flashed = defined(app.sessionCookie(response), 'a session cookie')
    let saved = await app.fetch('/admin/config', { headers: { Cookie: flashed } })
    expect(await saved.text()).toMatch(/role="status"[^>]*>Saved\./)
    let afterwards = await app.fetch('/admin/config', {
      headers: { Cookie: defined(app.sessionCookie(saved), 'a session cookie') },
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
    expect(rows[0]?.value).toBe('New Title')
  })

  it('rejects settings that are missing or invalid, keeping what was typed', async () => {
    for (let [field, value] of [
      ['siteTitle', '  '],
      ['siteDescription', ''],
      ['siteUrl', 'example.com'],
      ['siteUrl', 'https://example.com/blog'],
      ['siteUrl', 'javascript:alert(1)'],
    ] as const) {
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
    // As if another process wrote it: a second connection to the same file, going around the
    // app's commands.
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
  it('without uploads, has LogSpace’s icons, the title in the navbar, and no banner image', async () => {
    let favicon = await app.fetch('/favicon.ico')
    expect(favicon.status).toBe(200)
    expect(favicon.headers.get('Content-Type')).toBe('image/x-icon')
    // An ICO file's header.
    expect([...(await favicon.bytes()).subarray(0, 4)]).toEqual([0, 0, 1, 0])
    for (let [file, size] of [
      ['icon-192.png', 192],
      ['icon-512.png', 512],
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
    let icon = capture(html, /<link rel="icon" href="\/favicon\.ico\?v=([0-9a-f]{12})"/)
    // A URL with the current version is cached for good.
    let versioned = await app.fetch(`/favicon.ico?v=${icon}`)
    expect(versioned.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(favicon.headers.get('Cache-Control')).toBe('public, max-age=3600')
  })

  it('uploads a logo, icon, and banner image, which pages use, and removes them', async () => {
    let logo = await png(800, 200)
    let defaultFavicon = await (await app.fetch('/favicon.ico')).bytes()
    let response = await save(
      imageForm(
        { logo, icon: await png(600, 600), bannerImage: await jpeg(1800, 600) },
        { bannerImageAlt: 'A red card' },
      ),
    )
    expect(response.status).toBe(303)
    let saved = await savedConfig()
    let savedLogo = defined(saved.logo, 'the logo')
    let icon = defined(saved.icon, 'the icon')
    let bannerImage = defined(saved.bannerImage, 'the banner image')
    expect({ ...savedLogo, version: undefined }).toEqual({
      file: 'logo.png',
      width: 640,
      height: 160,
      version: undefined,
    })
    expect(icon.file).toBe('icon-512.png')
    expect([bannerImage.file, bannerImage.width]).toEqual(['banner.jpg', 1500])

    let logoFile = await app.fetch('/site/logo.png')
    expect(logoFile.headers.get('Content-Type')).toBe('image/png')
    expect(await imageSize(logoFile)).toEqual({ width: 640, height: 160, format: 'png' })
    expect(await (await app.fetch('/favicon.ico')).bytes()).not.toEqual(defaultFavicon)
    expect(await imageSize(await app.fetch('/site/banner.jpg'))).toEqual({
      width: 1500,
      height: 500,
      format: 'jpeg',
    })

    let html = await (await app.fetch('/')).text()
    expect(html).toMatch(
      new RegExp(
        `<span role="img" aria-label="Test Site"[^>]*mask-image: url\\(&quot;/site/logo\\.png\\?v=${savedLogo.version}&quot;\\)`,
      ),
    )
    expect(html).toContain(
      `<meta property="og:image" content="https://example.com/site/banner.jpg?v=${bannerImage.version}">`,
    )
    expect(html).toContain('<meta property="og:image:alt" content="A red card">')
    expect(html).toContain('<meta property="og:image:width" content="1500">')
    // The banner is at the top of the home page, and fetched first.
    let banner = `/site/banner.jpg?v=${bannerImage.version}`
    expect(html).toContain(
      `<img src="${banner}" alt="A red card" width="1500" height="500" fetchpriority="high" class="banner">`,
    )
    expect(html).toContain(`<link rel="preload" as="image" href="${banner}" fetchpriority="high">`)
    expect(html).toContain(`href="/favicon.ico?v=${icon.version}"`)
    expect((await manifest()).icons[0]?.src).toBe(`/site/icon-192.png?v=${icon.version}`)

    // A PNG stays a PNG, and the JPEG it replaces goes.
    await save(imageForm({ bannerImage: await png(1200, 630) }, { bannerImageAlt: 'Red' }))
    expect((await savedConfig()).bannerImage?.file).toBe('banner.png')
    expect((await app.fetch('/site/banner.jpg')).status).toBe(404)
    expect((await app.fetch('/site/banner.png')).status).toBe(200)

    let removed = imageForm({})
    for (let kind of ['logo', 'icon', 'bannerImage']) removed.set(`${kind}Remove`, 'on')
    expect((await save(removed)).status).toBe(303)
    let config = await savedConfig()
    expect([config.logo, config.icon, config.bannerImage]).toEqual([
      undefined,
      undefined,
      undefined,
    ])
    expect((await app.fetch('/site/logo.png')).status).toBe(404)
    expect(await (await app.fetch('/favicon.ico')).bytes()).toEqual(defaultFavicon)
  })

  it('makes the icon’s files from a square upload, and names the web app’s color', async () => {
    // LogSpace's icon is a dark gray circle.
    let { theme_color, background_color, icons } = await manifest()
    expect([theme_color, background_color]).toEqual(['#161616', '#161616'])
    expect(icons.length).toBe(2)

    expect((await save(imageForm({ icon: await jpeg(700, 700) }))).status).toBe(303)
    expect((await savedConfig()).icon?.file).toBe('icon-512.png')
    for (let [path, size] of [
      ['/apple-touch-icon.png', 180],
      ['/site/icon-192.png', 192],
      ['/site/icon-512.png', 512],
    ] as const) {
      expect(await imageSize(await app.fetch(path))).toEqual({
        width: size,
        height: size,
        format: 'png',
      })
    }
    let favicon = (await (await app.fetch('/favicon.ico')).bytes()).subarray(22)
    expect(await new Bun.Image(favicon).metadata()).toMatchObject({ width: 32, height: 32 })

    // Without a color of its own, the web app's is white.
    let uploaded = await manifest()
    expect([uploaded.theme_color, uploaded.background_color]).toEqual(['#ffffff', '#ffffff'])
  })

  it('refuses icons that aren’t square or big enough, SVGs, and WebP banner images', async () => {
    let svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'logo.svg', {
      type: 'image/svg+xml',
    })
    for (let [field, file, message] of [
      ['icon', await png(600, 512), /Icon: The icon must be square, at least 512 × 512 pixels\./],
      ['icon', await png(256, 256), /Icon: The icon must be square, at least 512 × 512 pixels\./],
      ['logo', svg, /Logo: That file isn’t an image\./],
      ['bannerImage', await image('webp', 1200, 630), /Upload a PNG or JPEG image\./],
    ] as const) {
      let response = await save(imageForm({ [field]: file }, { bannerImageAlt: 'Alt text' }))
      expect([field, response.status]).toEqual([field, 400])
      expect(await response.text()).toMatch(message)
    }
    expect(await savedConfig()).toEqual(TEST_SITE_CONFIG)
  })

  it('rejects an upload that isn’t an image, and a banner image without alt text', async () => {
    let notImage = new File(['hello'], 'logo.png', { type: 'image/png' })
    let response = await save(imageForm({ logo: notImage, bannerImage: await jpeg(1200, 630) }))
    let html = await response.text()
    expect(response.status).toBe(400)
    expect(html).toMatch(/Logo: That file isn’t an image\./)
    expect(html).toMatch(/Banner image alt text: Describe the banner image/)
    expect(html).toMatch(/<input [^>]*name="logo"[^>]*aria-invalid="true"/)
    expect(await savedConfig()).toEqual(TEST_SITE_CONFIG)
    expect((await app.fetch('/site/banner.jpg')).status).toBe(404)
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
    let datastar = capture(html, /src="(\/assets\/datastar\.[^"]+)"/)
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
    let cookie = defined(fresh.sessionCookie(await fresh.logIn()), 'a session cookie')
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
    let cookie = defined(fresh.sessionCookie(await fresh.logIn()), 'a session cookie')
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
    let cookie = defined(proxied.sessionCookie(await proxied.logIn()), 'a session cookie')
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
