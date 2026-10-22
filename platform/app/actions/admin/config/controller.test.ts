import sharp from 'sharp'
import * as assert from 'remix/assert'
import { beforeEach, describe, it } from 'remix/test'

import { adminFetch, fetch, sessionCookie } from '../../../../test/client.ts'
import { seedDatabase, TEST_SITE_CONFIG } from '../../../../test/seed.ts'
import { getSiteConfig } from '../../../data/config.ts'
import { db } from '../../../data/db.ts'
import { config } from '../../../data/tables.ts'
import { routes } from '../../../routes.ts'

beforeEach(seedDatabase)

describe('admin config page', () => {
  let save = (body: URLSearchParams | FormData, headers?: HeadersInit) =>
    adminFetch(routes.admin.config.action.href(), { method: 'POST', headers, body })

  function configForm(fields: Record<string, string> = {}) {
    return new URLSearchParams({ ...TEST_SITE_CONFIG, ...fields })
  }

  it('needs an admin login', async () => {
    let page = await fetch(routes.admin.config.index.href())
    assert.equal(page.status, 302)
    assert.equal(page.headers.get('Location'), routes.admin.login.href())

    let save = await fetch(routes.admin.config.action.href(), {
      method: 'POST',
      body: configForm({ siteTitle: 'Hacked' }),
    })
    assert.equal(save.status, 302)
    assert.equal(getSiteConfig().siteTitle, TEST_SITE_CONFIG.siteTitle)
  })

  it('is linked from /admin and shows the current settings', async () => {
    let admin = await (await adminFetch(routes.admin.index.href())).text()
    assert.match(admin, /href="\/admin\/config"/)
    let html = await (await adminFetch(routes.admin.config.index.href())).text()
    assert.match(html, /<input [^>]*name="siteTitle"[^>]* value="Test Site"/)
    assert.match(html, /<input [^>]*name="siteUrl"[^>]* value="https:\/\/example\.com"/)
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
    assert.equal(response.status, 303)
    assert.equal(response.headers.get('Location'), routes.admin.config.index.href())
    assert.deepEqual(getSiteConfig(), {
      ...TEST_SITE_CONFIG,
      siteTitle: 'New Title',
      siteUrl: 'https://new.example.com',
      heroHeading: '',
      heroSubheading: 'Line one line two',
    })

    // The next page says it was saved, once.
    let flashed = sessionCookie(response)!
    let saved = await fetch(routes.admin.config.index.href(), { headers: { Cookie: flashed } })
    assert.match(await saved.text(), /role="status"[^>]*>Saved\./)

    let home = await (await fetch(routes.home.href())).text()
    assert.match(home, /<title>New Title<\/title>/)
    assert.match(home, /rel="canonical" href="https:\/\/new\.example\.com\/"/)
    assert.doesNotMatch(home, /<h1>/)
    assert.match(home, /<p>Line one line two<\/p>/)
    let robots = await (await fetch(routes.robots.href())).text()
    assert.match(robots, /Sitemap: https:\/\/new\.example\.com\/sitemap\.xml/)

    // It's stored in the database, not just in memory.
    let rows = await db.findMany(config)
    assert.equal(rows.find((row) => row.key === 'siteTitle')?.value, 'New Title')
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
      assert.equal(response.status, 400, `${field}: ${value}`)
      assert.match(html, /role="alert"/)
      assert.match(
        html,
        new RegExp(
          `<input [^>]*name="${field}"[^>]*aria-invalid="true"|<textarea [^>]*name="${field}"[^>]*aria-invalid="true"`,
        ),
      )
      assert.match(html, /value="Typed heading"/)
    }
    assert.deepEqual(getSiteConfig(), TEST_SITE_CONFIG)
  })

  it('rejects config forms posted from other sites', async () => {
    let response = await save(configForm({ siteTitle: 'Hacked' }), {
      'Sec-Fetch-Site': 'cross-site',
    })
    assert.equal(response.status, 403)
    assert.equal(getSiteConfig().siteTitle, TEST_SITE_CONFIG.siteTitle)
  })

  // The config form with images, as the browser sends it.
  function imageForm(files: Record<string, File>, fields: Record<string, string> = {}) {
    let form = new FormData()
    for (let [name, value] of Object.entries({ ...TEST_SITE_CONFIG, ...fields })) {
      form.set(name, value)
    }
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

  it('without uploads, has LogSpace’s icons, the title in the navbar, and no social image', async () => {
    let favicon = await fetch(routes.favicon.href())
    assert.equal(favicon.status, 200)
    assert.equal(favicon.headers.get('Content-Type'), 'image/x-icon')
    // An ICO file's header.
    assert.deepEqual([...(await favicon.bytes()).subarray(0, 4)], [0, 0, 1, 0])
    for (let [file, size] of [
      ['icon-192.png', 192],
      ['icon-512.png', 512],
      ['icon-maskable-512.png', 512],
    ] as const) {
      let response = await fetch(routes.siteFile.href({ file }))
      assert.deepEqual(await imageSize(response), { width: size, height: size, format: 'png' })
    }
    let apple = await fetch(routes.appleTouchIcon.href())
    assert.deepEqual(await imageSize(apple), { width: 180, height: 180, format: 'png' })
    assert.equal((await fetch(routes.siteFile.href({ file: 'logo.png' }))).status, 404)
    assert.equal((await fetch(routes.siteFile.href({ file: 'favicon.ico' }))).status, 404)

    let html = await (await fetch(routes.home.href())).text()
    assert.match(html, /<header[^]*>Test Site<\/span><\/a>[^]*<\/header>/)
    assert.doesNotMatch(html, /og:image/)
    assert.match(html, /<meta [^>]*name="twitter:card" content="summary"/)
    let icon = html.match(/<link [^>]*rel="icon" href="\/favicon\.ico\?v=([0-9a-f]{12})"/)
    assert.ok(icon)
    // A URL with the current version is cached for good.
    let versioned = await fetch(`${routes.favicon.href()}?v=${icon[1]}`)
    assert.equal(versioned.headers.get('Cache-Control'), 'public, max-age=31536000, immutable')
    assert.equal(favicon.headers.get('Cache-Control'), 'public, max-age=3600')
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
    let defaultFavicon = await (await fetch(routes.favicon.href())).bytes()
    let response = await save(
      imageForm(
        { logo, icon: await png(600, 600), socialImage: await jpeg(1600, 840) },
        { socialImageAlt: 'A red card' },
      ),
    )
    assert.equal(response.status, 303)
    let { logo: savedLogo, icon, socialImage } = getSiteConfig()
    assert.deepEqual(
      { ...savedLogo, version: undefined },
      { file: 'logo.png', width: 640, height: 160, version: undefined },
    )
    assert.equal(icon?.file, 'icon-512.png')
    assert.deepEqual([socialImage?.file, socialImage?.width], ['social.jpg', 1200])

    let logoFile = await fetch(routes.siteFile.href({ file: 'logo.png' }))
    assert.equal(logoFile.headers.get('Content-Type'), 'image/png')
    assert.deepEqual(await imageSize(logoFile), { width: 640, height: 160, format: 'png' })
    assert.notDeepEqual(await (await fetch(routes.favicon.href())).bytes(), defaultFavicon)
    let social = await fetch(routes.siteFile.href({ file: 'social.jpg' }))
    assert.deepEqual(await imageSize(social), { width: 1200, height: 630, format: 'jpeg' })

    let html = await (await fetch(routes.home.href())).text()
    assert.match(
      html,
      new RegExp(
        `<span role="img" aria-label="Test Site"[^>]*mask-image: url\\(&quot;/site/logo\\.png\\?v=${savedLogo!.version}&quot;\\)`,
      ),
    )
    assert.match(
      html,
      new RegExp(
        `<meta [^>]*property="og:image" content="https://example\\.com/site/social\\.jpg\\?v=${socialImage!.version}"`,
      ),
    )
    assert.match(html, /<meta [^>]*property="og:image:alt" content="A red card"/)
    assert.match(html, /<meta [^>]*property="og:image:width" content="1200"/)
    assert.match(html, new RegExp(`href="/favicon\\.ico\\?v=${icon!.version}"`))
    let manifest = await (await fetch(routes.manifest.href())).json()
    assert.equal(manifest.icons[0].src, `/site/icon-192.png?v=${icon!.version}`)

    // A PNG stays a PNG, and the JPEG it replaces goes.
    await save(imageForm({ socialImage: await png(1200, 630) }, { socialImageAlt: 'Red' }))
    assert.equal(getSiteConfig().socialImage?.file, 'social.png')
    assert.equal((await fetch(routes.siteFile.href({ file: 'social.jpg' }))).status, 404)
    assert.equal((await fetch(routes.siteFile.href({ file: 'social.png' }))).status, 200)

    let removed = imageForm({})
    for (let kind of ['logo', 'icon', 'socialImage']) removed.set(`${kind}Remove`, 'on')
    assert.equal((await save(removed)).status, 303)
    let config = getSiteConfig()
    assert.deepEqual(
      [config.logo, config.icon, config.socialImage],
      [undefined, undefined, undefined],
    )
    assert.equal((await fetch(routes.siteFile.href({ file: 'logo.png' }))).status, 404)
    assert.deepEqual(await (await fetch(routes.favicon.href())).bytes(), defaultFavicon)
  })

  it('puts the home screen icons on the color the icon is, and keeps the rest transparent', async () => {
    // The color of a pixel of one of the site's images, with its alpha.
    async function pixel(path: string, x: number, y: number) {
      let { data, info } = await sharp(await (await fetch(path)).bytes())
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      let i = (y * info.width + x) * 4
      return [...data.subarray(i, i + 4)]
    }

    // LogSpace's icon is a dark gray rounded square.
    let manifest = await (await fetch(routes.manifest.href())).json()
    assert.deepEqual([manifest.theme_color, manifest.background_color], ['#161616', '#161616'])

    // A dark blue circle on a transparent background, with a small white mark.
    let svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' +
      '<circle cx="256" cy="256" r="200" fill="#1d3557"/><rect x="226" y="226" width="60" height="60" fill="#fff"/></svg>'
    let icon = new File([svg], 'icon.svg', { type: 'image/svg+xml' })
    let response = await save(imageForm({ icon }))
    assert.equal(response.status, 303)
    assert.equal(getSiteConfig().icon?.color, '#1d3557')

    let dark = [0x1d, 0x35, 0x57, 255]
    assert.deepEqual(await pixel(routes.appleTouchIcon.href(), 0, 0), dark)
    let maskable = routes.siteFile.href({ file: 'icon-maskable-512.png' })
    assert.deepEqual(await pixel(maskable, 0, 0), dark)
    assert.deepEqual(await pixel(maskable, 256, 256), [255, 255, 255, 255])
    for (let file of ['icon-192.png', 'icon-512.png']) {
      assert.equal((await pixel(routes.siteFile.href({ file }), 0, 0))[3], 0, file)
    }
    let favicon = (await (await fetch(routes.favicon.href())).bytes()).subarray(22)
    let { data } = await sharp(favicon).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    assert.equal(data[3], 0, 'favicon.ico')

    manifest = await (await fetch(routes.manifest.href())).json()
    assert.deepEqual([manifest.theme_color, manifest.background_color], ['#1d3557', '#1d3557'])
  })

  it('puts an icon with no opaque pixels on white', async () => {
    let data = await sharp({
      create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } },
    })
      .png()
      .toBuffer()
    let response = await save(imageForm({ icon: new File([new Uint8Array(data)], 'icon.png') }))
    assert.equal(response.status, 303)
    assert.equal(getSiteConfig().icon?.color, '#ffffff')
  })

  it('rejects an upload that isn’t an image, and a social image without alt text', async () => {
    let notImage = new File(['hello'], 'logo.png', { type: 'image/png' })
    let response = await save(imageForm({ logo: notImage, socialImage: await jpeg(1200, 630) }))
    let html = await response.text()
    assert.equal(response.status, 400)
    assert.match(html, /Logo: That file isn’t an image\./)
    assert.match(html, /Social preview image alt text: Describe the social preview image/)
    assert.match(html, /<input [^>]*name="logo"[^>]*aria-invalid="true"/)
    assert.deepEqual(getSiteConfig(), TEST_SITE_CONFIG)
    assert.equal((await fetch(routes.siteFile.href({ file: 'social.jpg' }))).status, 404)
  })
})
