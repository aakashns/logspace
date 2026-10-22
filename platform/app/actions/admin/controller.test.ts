import sharp from 'sharp'
import * as assert from 'remix/assert'
import { beforeAll, describe, it } from 'remix/test'

import { getSiteConfig, saveSiteConfig } from '../../data/config.ts'
import { db } from '../../data/db.ts'
import { hasPostFile, savePostFile } from '../../data/media.ts'
import { getPosts } from '../../data/posts.ts'
import { config, fromPostRecord, posts } from '../../data/tables.ts'
import { router } from '../../router.ts'
import { routes } from '../../routes.ts'
import { seedDatabase, seedMedia, TEST_SITE_CONFIG } from '../../../test/seed.ts'

// npm test sets ADMIN_PASSWORD to this and uses an in-memory database.
const PASSWORD = 'test-password-1234'

function fetch(path: string, init?: RequestInit) {
  return router.fetch(new Request(new URL(path, 'http://localhost'), init))
}

function logInAdmin(password: string, headers?: HeadersInit) {
  return fetch(routes.admin.authenticate.href(), {
    method: 'POST',
    headers,
    body: new URLSearchParams({ password }),
  })
}

// The `name=value` part of the session cookie a response sets, to send back on later requests.
function sessionCookie(response: Response) {
  let header = response.headers.getSetCookie().find((cookie) => cookie.startsWith('admin_session='))
  return header?.split(';')[0]
}

beforeAll(async () => {
  await seedDatabase()
  await seedMedia()
})

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
    let response = await logInAdmin(PASSWORD)
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
    let cookie = sessionCookie(await logInAdmin(PASSWORD))!
    let tampered = cookie.slice(0, -2) + (cookie.endsWith('A') ? 'BB' : 'AA')
    let page = await fetch(routes.admin.index.href(), { headers: { Cookie: tampered } })
    assert.equal(page.status, 302)
  })

  it('rejects admin logins posted from other sites', async () => {
    let response = await logInAdmin(PASSWORD, { 'Sec-Fetch-Site': 'cross-site' })
    assert.equal(response.status, 403)
    assert.equal(sessionCookie(response), undefined)
  })
})

describe('admin config page', () => {
  async function adminFetch(path: string, init?: RequestInit) {
    let cookie = sessionCookie(await logInAdmin(PASSWORD))!
    return fetch(path, { ...init, headers: { Cookie: cookie, ...init?.headers } })
  }

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
    let cookie = sessionCookie(await logInAdmin(PASSWORD))!
    try {
      let response = await fetch(routes.admin.config.action.href(), {
        method: 'POST',
        headers: { Cookie: cookie },
        body: configForm({
          siteTitle: '  New Title ',
          siteUrl: 'https://new.example.com/',
          heroHeading: '',
          heroSubheading: 'Line one\r\nline two',
        }),
      })
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
      let flashed = sessionCookie(response) ?? cookie
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
    } finally {
      await saveSiteConfig(TEST_SITE_CONFIG)
    }
  })

  it('rejects settings that are missing or invalid, keeping what was typed', async () => {
    for (let [field, value] of [
      ['siteTitle', '  '],
      ['siteDescription', ''],
      ['siteUrl', 'example.com'],
      ['siteUrl', 'https://example.com/blog'],
      ['siteUrl', 'javascript:alert(1)'],
    ]) {
      let response = await adminFetch(routes.admin.config.action.href(), {
        method: 'POST',
        body: configForm({ [field]: value, heroHeading: 'Typed heading' }),
      })
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
    let response = await adminFetch(routes.admin.config.action.href(), {
      method: 'POST',
      headers: { 'Sec-Fetch-Site': 'cross-site' },
      body: configForm({ siteTitle: 'Hacked' }),
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
    let cookie = sessionCookie(await logInAdmin(PASSWORD))!
    let post = (body: FormData) =>
      fetch(routes.admin.config.action.href(), {
        method: 'POST',
        headers: { Cookie: cookie },
        body,
      })
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
    try {
      let response = await post(
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
      await post(imageForm({ socialImage: await png(1200, 630) }, { socialImageAlt: 'Red' }))
      assert.equal(getSiteConfig().socialImage?.file, 'social.png')
      assert.equal((await fetch(routes.siteFile.href({ file: 'social.jpg' }))).status, 404)
      assert.equal((await fetch(routes.siteFile.href({ file: 'social.png' }))).status, 200)

      let removed = imageForm({})
      for (let kind of ['logo', 'icon', 'socialImage']) removed.set(`${kind}Remove`, 'on')
      assert.equal((await post(removed)).status, 303)
      let config = getSiteConfig()
      assert.deepEqual(
        [config.logo, config.icon, config.socialImage],
        [undefined, undefined, undefined],
      )
      assert.equal((await fetch(routes.siteFile.href({ file: 'logo.png' }))).status, 404)
      assert.deepEqual(await (await fetch(routes.favicon.href())).bytes(), defaultFavicon)
    } finally {
      await saveSiteConfig(TEST_SITE_CONFIG)
    }
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

    // LogSpace's icon is a dark gray circle.
    let manifest = await (await fetch(routes.manifest.href())).json()
    assert.deepEqual([manifest.theme_color, manifest.background_color], ['#161616', '#161616'])

    // A dark blue circle on a transparent background, with a small white mark.
    let svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' +
      '<circle cx="256" cy="256" r="200" fill="#1d3557"/><rect x="226" y="226" width="60" height="60" fill="#fff"/></svg>'
    let icon = new File([svg], 'icon.svg', { type: 'image/svg+xml' })
    let cookie = sessionCookie(await logInAdmin(PASSWORD))!
    try {
      let response = await fetch(routes.admin.config.action.href(), {
        method: 'POST',
        headers: { Cookie: cookie },
        body: imageForm({ icon }),
      })
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
    } finally {
      await saveSiteConfig(TEST_SITE_CONFIG)
    }
  })

  it('puts an icon with no opaque pixels on white', async () => {
    let data = await sharp({
      create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } },
    })
      .png()
      .toBuffer()
    let cookie = sessionCookie(await logInAdmin(PASSWORD))!
    try {
      let response = await fetch(routes.admin.config.action.href(), {
        method: 'POST',
        headers: { Cookie: cookie },
        body: imageForm({ icon: new File([new Uint8Array(data)], 'icon.png') }),
      })
      assert.equal(response.status, 303)
      assert.equal(getSiteConfig().icon?.color, '#ffffff')
    } finally {
      await saveSiteConfig(TEST_SITE_CONFIG)
    }
  })

  it('rejects an upload that isn’t an image, and a social image without alt text', async () => {
    let notImage = new File(['hello'], 'logo.png', { type: 'image/png' })
    let response = await adminFetch(routes.admin.config.action.href(), {
      method: 'POST',
      body: imageForm({ logo: notImage, socialImage: await jpeg(1200, 630) }),
    })
    let html = await response.text()
    assert.equal(response.status, 400)
    assert.match(html, /Logo: That file isn’t an image\./)
    assert.match(html, /Social preview image alt text: Describe the social preview image/)
    assert.match(html, /<input [^>]*name="logo"[^>]*aria-invalid="true"/)
    assert.deepEqual(getSiteConfig(), TEST_SITE_CONFIG)
    assert.equal((await fetch(routes.siteFile.href({ file: 'social.jpg' }))).status, 404)
  })
})

describe('admin post pages', () => {
  // A text post's form fields, as the browser sends them.
  function textPostForm(fields: Record<string, string> = {}) {
    return new URLSearchParams({
      type: 'text',
      date: '2026-10-21T09:30',
      offset: '+05:30',
      city: '',
      caption: 'Hello\r\nworld',
      ...fields,
    })
  }

  async function adminFetch(path: string, init?: RequestInit) {
    let cookie = sessionCookie(await logInAdmin(PASSWORD))!
    return fetch(path, { ...init, headers: { Cookie: cookie, ...init?.headers } })
  }

  async function findPost(id: string) {
    return (await getPosts()).find((post) => post.id === id)
  }

  it('need an admin login', async () => {
    let [post] = await getPosts()
    for (let path of [
      routes.admin.posts.new.index.href(),
      routes.admin.posts.edit.index.href({ id: post.id }),
    ]) {
      let response = await fetch(path)
      assert.equal(response.status, 302, path)
      assert.equal(response.headers.get('Location'), routes.admin.login.href())
    }

    let edit = await fetch(routes.admin.posts.edit.action.href({ id: post.id }), {
      method: 'POST',
      body: textPostForm({ caption: 'Not logged in' }),
    })
    assert.equal(edit.status, 302)
    assert.notEqual((await findPost(post.id))?.caption, 'Not logged in')
  })

  it('/admin links to the new post page and to each post’s edit page', async () => {
    let html = await (await adminFetch(routes.admin.index.href())).text()
    assert.match(html, /href="\/admin\/posts\/new"/)
    for (let post of await getPosts()) {
      assert.match(html, new RegExp(`href="/admin/posts/${post.id}/edit"`))
    }
  })

  it('the edit page starts with the post’s values', async () => {
    let post = (await getPosts()).find((post) => post.type === 'photos')!
    if (post.type !== 'photos') throw new Error('No photos post')
    let html = await (await adminFetch(routes.admin.posts.edit.index.href({ id: post.id }))).text()

    // The type is shown but can't be changed, and only its fields are there.
    assert.doesNotMatch(html, /<input [^>]*name="type"/)
    assert.match(html, /Type: Photos/)
    assert.doesNotMatch(html, /<input [^>]*name="video_file"/)
    assert.match(html, new RegExp(`<input [^>]*name="city"[^>]*value="${post.city}"`))
    assert.match(html, new RegExp(`<textarea [^>]*name="caption"[^>]*>${post.caption}</textarea>`))
    assert.match(html, /<input [^>]*name="photo_file"[^>]*value="hike-1\.jpg"/)
  })

  it('saving an edit updates the post and shows it', async () => {
    let post = (await getPosts()).find((post) => post.type === 'text')!
    let response = await adminFetch(routes.admin.posts.edit.action.href({ id: post.id }), {
      method: 'POST',
      body: textPostForm({ city: 'Hanoi' }),
    })
    assert.equal(response.status, 303)
    assert.equal(response.headers.get('Location'), routes.posts.show.href({ id: post.id }))

    let saved = await findPost(post.id)
    assert.equal(saved?.caption, 'Hello\nworld')
    assert.equal(saved?.city, 'Hanoi')
    assert.equal(saved?.date, '2026-10-21T09:30:00+05:30')
    let page = await (await fetch(routes.posts.show.href({ id: post.id }))).text()
    assert.match(page, /Hanoi/)
  })

  it('saving photos keeps them in order and drops empty rows', async () => {
    let post = (await getPosts()).find((post) => post.type === 'photos')!
    let body = textPostForm({ type: 'photos', caption: '' })
    for (let [file, alt] of [
      ['hike-3.jpg', 'Peak'],
      ['', ''],
      ['hike-1.jpg', 'River'],
    ]) {
      body.append('photo_file', file)
      body.append('photo_alt', alt)
    }
    let response = await adminFetch(routes.admin.posts.edit.action.href({ id: post.id }), {
      method: 'POST',
      body,
    })
    assert.equal(response.status, 303)

    let saved = await findPost(post.id)
    assert.equal(saved?.caption, undefined)
    // Their sizes come from the files.
    let photos = saved?.type === 'photos' ? saved.photos : []
    assert.deepEqual(
      photos.map(({ src, alt, width, height }) => ({ src: src.split('?')[0], alt, width, height })),
      [
        { src: `/posts/${post.id}/hike-3.jpg`, alt: 'Peak', width: 24, height: 32 },
        { src: `/posts/${post.id}/hike-1.jpg`, alt: 'River', width: 32, height: 21 },
      ],
    )
  })

  it('rejects an invalid edit with the reasons, and keeps what was typed', async () => {
    let post = (await getPosts()).find((post) => post.type === 'video')!
    let response = await adminFetch(routes.admin.posts.edit.action.href({ id: post.id }), {
      method: 'POST',
      body: textPostForm({
        type: 'video',
        caption: 'Typed caption',
        video_file: 'missing.mp4',
        video_width: 'wide',
      }),
    })
    let html = await response.text()
    assert.equal(response.status, 400)
    assert.match(html, /role="alert"/)
    assert.match(html, /Video width: Expected a size in pixels/)
    let widthInput = html.match(/<input [^>]*name="video_width"[^>]*>/)?.[0] ?? ''
    assert.match(widthInput, /value="wide"/)
    assert.match(widthInput, /aria-invalid="true"/)
    assert.match(html, /Typed caption/)
    assert.deepEqual(await findPost(post.id), post)

    // Valid fields, but a file that isn't in the post's media.
    let missing = await adminFetch(routes.admin.posts.edit.action.href({ id: post.id }), {
      method: 'POST',
      body: textPostForm({ type: 'video', video_file: 'missing.mp4' }),
    })
    assert.equal(missing.status, 400)
    assert.match(await missing.text(), /missing\.mp4 isn’t one of this post’s files/)
  })

  it('creates a new post, once', async () => {
    let page = await (await adminFetch(routes.admin.posts.new.index.href())).text()
    let id = page.match(/<input [^>]*name="id"[^>]*value="([0-9a-z]{10})"/)?.[1]
    assert.ok(id)

    let submit = () =>
      adminFetch(routes.admin.posts.new.action.href(), {
        method: 'POST',
        body: textPostForm({ id, caption: 'A brand new post' }),
      })
    let response = await submit()
    assert.equal(response.status, 303)
    assert.equal(response.headers.get('Location'), routes.posts.show.href({ id }))
    assert.match(await (await fetch(routes.home.href())).text(), /A brand new post/)

    let again = await submit()
    assert.equal(again.status, 400)
    assert.match(await again.text(), /already published/)
  })

  it('rejects a new text post without a caption', async () => {
    let id = 'zzzzzzzzzz'
    let response = await adminFetch(routes.admin.posts.new.action.href(), {
      method: 'POST',
      body: textPostForm({ id, caption: '  ' }),
    })
    assert.equal(response.status, 400)
    assert.match(await response.text(), /Caption: Text posts need a caption/)
    assert.equal(await findPost(id), undefined)
  })

  it('an edit can’t change the post’s type', async () => {
    let post = (await getPosts()).find((post) => post.type === 'text')!
    let response = await adminFetch(routes.admin.posts.edit.action.href({ id: post.id }), {
      method: 'POST',
      body: textPostForm({ type: 'article', caption: 'Still text' }),
    })
    assert.equal(response.status, 303)
    let saved = await findPost(post.id)
    assert.equal(saved?.type, 'text')
    assert.equal(saved?.caption, 'Still text')
  })

  it('saves an article’s body in the database', async () => {
    let post = (await getPosts()).find((post) => post.type === 'article')!
    if (post.type !== 'article') throw new Error('No article post')
    let edit = routes.admin.posts.edit
    let html = await (await adminFetch(edit.index.href({ id: post.id }))).text()
    assert.match(html, /<textarea [^>]*name="article_body"[^>]*>[^<]*\S/)

    let form = (body: string) =>
      textPostForm({
        type: 'article',
        article_title: post.article.title,
        article_summary: post.article.summary,
        article_body: body,
      })
    let response = await adminFetch(edit.action.href({ id: post.id }), {
      method: 'POST',
      body: form('## Rewritten\r\n\r\nWith ![a desk](desk.jpg) in it.'),
    })
    assert.equal(response.status, 303)
    let saved = await findPost(post.id)
    assert.equal(
      saved?.type === 'article' && saved.article.body,
      '## Rewritten\n\nWith ![a desk](desk.jpg) in it.',
    )
    // Stored in its own column, for search, rather than in the details JSON.
    let row = await db.find(posts, post.id)
    assert.equal(row?.article_body, '## Rewritten\n\nWith ![a desk](desk.jpg) in it.')
    assert.doesNotMatch(row?.details ?? '', /Rewritten/)
    let page = await (await fetch(routes.posts.show.href({ id: post.id }))).text()
    assert.match(page, /<h2[^>]*>Rewritten<\/h2>/)
    assert.match(page, new RegExp(`<img src="/posts/${post.id}/desk\\.jpg"`))

    let empty = await adminFetch(edit.action.href({ id: post.id }), {
      method: 'POST',
      body: form('   '),
    })
    assert.equal(empty.status, 400)
    assert.match(await empty.text(), /Article body: Articles need a body/)
  })

  it('keeps Markdown exactly as typed, through a save and an unrelated edit', async () => {
    let post = (await getPosts()).find((post) => post.type === 'article')!
    if (post.type !== 'article') throw new Error('No article post')
    let edit = routes.admin.posts.edit
    // An indented code fence strips its indentation from the code, so the opening line's spaces
    // matter; so do a caption's, where four start a code block.
    let body = '  ```python\n  print("hello")\n  ```\n\nAfter the code.\n'
    let caption = '    indented code\n\nThen text.'
    // Browsers send textarea line breaks as \r\n.
    let crlf = (text: string) => text.replaceAll('\n', '\r\n')
    let save = (title: string, fields: { caption: string; body: string }) =>
      adminFetch(edit.action.href({ id: post.id }), {
        method: 'POST',
        body: textPostForm({
          type: 'article',
          caption: crlf(fields.caption),
          article_title: title,
          article_summary: post.article.summary,
          article_body: crlf(fields.body),
        }),
      })
    let saved = async () => {
      let found = await findPost(post.id)
      if (found?.type !== 'article') throw new Error('Not an article')
      return found
    }

    assert.equal((await save('First', { caption, body })).status, 303)
    assert.equal((await saved()).article.body, body)
    assert.equal((await saved()).caption, caption)
    let page = await (await fetch(routes.posts.show.href({ id: post.id }))).text()
    assert.match(page, /<code[^>]*>print\(&quot;hello&quot;\)/)

    // Resubmit what the edit page shows, changing only the title.
    let html = await (await adminFetch(edit.index.href({ id: post.id }))).text()
    let textarea = (name: string) =>
      unescapeHtml(
        html.match(new RegExp(`<textarea [^>]*name="${name}"[^>]*>([^<]*)</textarea>`))![1],
      )
    assert.equal(
      (await save('Second', { caption: textarea('caption'), body: textarea('article_body') }))
        .status,
      303,
    )
    let after = await saved()
    assert.equal(after.article.title, 'Second')
    assert.equal(after.article.body, body)
    assert.equal(after.caption, caption)

    // Blank Markdown still counts as missing.
    let blank = await save('Third', { caption: '  \n ', body: ' \n\n ' })
    assert.equal(blank.status, 400)
    assert.match(await blank.text(), /Article body: Articles need a body/)
  })

  it('deletes a post from its edit page', async () => {
    let id = 'deleteme00'
    await db.create(
      posts,
      fromPostRecord({ id, type: 'text', date: '2026-10-01T09:00:00Z', caption: 'Bye' }),
    )
    let edit = await (await adminFetch(routes.admin.posts.edit.index.href({ id }))).text()
    assert.match(edit, /<dialog id="delete-post"/)
    assert.match(edit, /<form method="post" action="\/admin\/posts\/deleteme00\/delete"/)
    assert.match(edit, /command="show-modal"/)
    let newPage = await (await adminFetch(routes.admin.posts.new.index.href())).text()
    assert.doesNotMatch(newPage, /delete-post/)

    let path = routes.admin.posts.delete.href({ id })
    let loggedOut = await fetch(path, { method: 'POST' })
    assert.equal(loggedOut.status, 302)
    assert.ok(await findPost(id))

    // Its files are deleted with it, and other posts' files are left alone.
    await savePostFile(id, 'a.jpg', new File(['a'], 'a.jpg'))
    await savePostFile(id, 'b.mp4', new File(['b'], 'b.mp4'))
    let [other] = await getPosts()
    await savePostFile(other.id, 'keep.jpg', new File(['k'], 'keep.jpg'))

    let response = await adminFetch(path, { method: 'POST' })
    assert.equal(response.status, 303)
    assert.equal(response.headers.get('Location'), routes.admin.index.href())
    assert.equal(await findPost(id), undefined)
    assert.equal((await fetch(routes.posts.show.href({ id }))).status, 404)
    assert.equal(await hasPostFile(id, 'a.jpg'), false)
    assert.equal(await hasPostFile(id, 'b.mp4'), false)
    assert.equal(await hasPostFile(other.id, 'keep.jpg'), true)

    assert.equal((await adminFetch(path, { method: 'POST' })).status, 404)
  })

  // A post form with files, sent as multipart/form-data the way the browser sends it. A file
  // input left empty sends a nameless, empty file.
  function multipartForm(fields: Record<string, string>, files: [string, File][] = []) {
    let body = new FormData()
    for (let [name, value] of Object.entries(fields)) body.append(name, value)
    for (let [name, file] of files) body.append(name, file)
    return body
  }
  let noFile = () => new File([], '', { type: 'application/octet-stream' })

  it('the post form uploads files', async () => {
    let html = await (await adminFetch(routes.admin.posts.new.index.href())).text()
    assert.match(
      html,
      /<form method="post" action="\/admin\/posts\/new" enctype="multipart\/form-data"/,
    )
    assert.match(html, /<input [^>]*type="file" name="photo_upload"/)
    assert.match(html, /<input [^>]*name="photo_uploads" type="file"[^>]*multiple/)
  })

  it('uploads a new photos post’s files, which it’s published with', async () => {
    let id = 'uploadnew1'
    let response = await adminFetch(routes.admin.posts.new.action.href(), {
      method: 'POST',
      body: multipartForm(
        {
          id,
          type: 'photos',
          date: '2026-10-21T09:30',
          offset: '+05:30',
          caption: '',
          photo_file: '',
          photo_alt: 'First',
          photo_width: '',
          photo_height: '',
        },
        [
          ['photo_upload', new File(['one'], 'My Photo.jpg', { type: 'image/jpeg' })],
          ['photo_uploads', new File(['two'], 'two.png', { type: 'image/png' })],
          ['photo_uploads', new File(['three'], 'three.webp', { type: 'text/html' })],
          // Another type's fields are on the new post page too, but only the chosen type's count.
          ['video_upload', new File(['v'], 'clip.mp4', { type: 'video/mp4' })],
        ],
      ),
    })
    assert.equal(response.status, 303)
    let saved = await findPost(id)
    assert.deepEqual(saved?.type === 'photos' && saved.photos, [
      { src: `/posts/${id}/My-Photo.jpg`, alt: 'First' },
      { src: `/posts/${id}/two.png`, alt: '' },
      { src: `/posts/${id}/three.webp`, alt: '' },
    ])
    assert.equal(await hasPostFile(id, 'clip.mp4'), false)

    // Served with the type its name gives, not the one the browser claimed.
    let file = await fetch(`/posts/${id}/three.webp`)
    assert.equal(file.status, 200)
    assert.equal(file.headers.get('Content-Type'), 'image/webp')
    assert.equal(await file.text(), 'three')
  })

  it('an edit can replace a video and upload files for an article body', async () => {
    let video = (await getPosts()).find((post) => post.type === 'video')!
    let response = await adminFetch(routes.admin.posts.edit.action.href({ id: video.id }), {
      method: 'POST',
      body: multipartForm(
        { date: '2026-10-21T09:30', offset: '+05:30', video_file: 'flower.mp4' },
        [
          ['video_upload', new File(['new video'], 'garden.mp4')],
          ['video_poster_upload', noFile()],
        ],
      ),
    })
    assert.equal(response.status, 303)
    let saved = await findPost(video.id)
    assert.equal(saved?.type === 'video' && saved.video.src, `/posts/${video.id}/garden.mp4`)
    assert.equal(saved?.type === 'video' && saved.video.poster, undefined)

    let article = (await getPosts()).find((post) => post.type === 'article')!
    if (article.type !== 'article') throw new Error('No article post')
    let edit = await adminFetch(routes.admin.posts.edit.action.href({ id: article.id }), {
      method: 'POST',
      body: multipartForm(
        {
          date: '2026-10-21T09:30',
          offset: '+05:30',
          article_title: article.article.title,
          article_summary: article.article.summary,
          article_body: 'A chart:\n\n![Chart](chart.png)',
        },
        [
          ['article_uploads', new File(['png'], 'chart.png')],
          ['cover_upload', noFile()],
        ],
      ),
    })
    assert.equal(edit.status, 303)
    assert.equal(await hasPostFile(article.id, 'chart.png'), true)
    let page = await (
      await adminFetch(routes.admin.posts.edit.index.href({ id: article.id }))
    ).text()
    assert.match(
      page,
      new RegExp(`<a href="/posts/${article.id}/chart\\.png"><code>chart\\.png</code>`),
    )
  })

  it('rejects files that aren’t photos or videos, and keeps the ones that are', async () => {
    let id = 'uploadbad1'
    let response = await adminFetch(routes.admin.posts.new.action.href(), {
      method: 'POST',
      body: multipartForm(
        { id, type: 'video', date: '2026-10-21T09:30', offset: '+05:30', video_file: '' },
        [
          ['video_upload', new File(['v'], 'clip.mp4')],
          ['video_poster_upload', new File(['<svg/>'], 'poster.svg')],
        ],
      ),
    })
    let html = await response.text()
    assert.equal(response.status, 400)
    assert.match(html, /“poster\.svg” can’t be uploaded/)
    assert.equal(await findPost(id), undefined)
    assert.equal(await hasPostFile(id, 'poster.svg'), false)
    // The video was saved, so the form comes back naming it, and saving again publishes.
    assert.equal(await hasPostFile(id, 'clip.mp4'), true)
    assert.match(html, /<input [^>]*name="video_file"[^>]*value="clip\.mp4"/)
    assert.match(html, /<code>clip\.mp4<\/code>/)
  })

  it('doesn’t let a resubmitted new post form replace the published post’s files', async () => {
    let [post] = await getPosts()
    await savePostFile(post.id, 'same.jpg', new File(['original'], 'same.jpg'))
    let response = await adminFetch(routes.admin.posts.new.action.href(), {
      method: 'POST',
      body: multipartForm({ ...Object.fromEntries(textPostForm()), id: post.id }, [
        ['article_uploads', new File(['replaced'], 'same.jpg')],
      ]),
    })
    assert.equal(response.status, 400)
    let file = await fetch(`/posts/${post.id}/same.jpg`)
    assert.equal(await file.text(), 'original')
  })

  it('answers a form with too many files with a page saying so', async () => {
    let post = (await getPosts()).find((post) => post.type === 'text')!
    let files = Array.from({ length: 101 }, (): [string, File] => ['photo_upload', noFile()])
    let response = await adminFetch(routes.admin.posts.edit.action.href({ id: post.id }), {
      method: 'POST',
      body: multipartForm(Object.fromEntries(textPostForm({ caption: 'Too many' })), files),
    })
    assert.equal(response.status, 413)
    assert.match(await response.text(), /Upload too large/)
    assert.notEqual((await findPost(post.id))?.caption, 'Too many')
  })

  it('editing an unknown post is a 404', async () => {
    let response = await adminFetch(routes.admin.posts.edit.index.href({ id: 'nosuchpost' }))
    assert.equal(response.status, 404)
  })
})

function unescapeHtml(html: string) {
  return html
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
}
