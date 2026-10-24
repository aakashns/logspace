// The public pages and files.
import * as fsp from 'node:fs/promises'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { Effect, Schema } from 'effect'

import { PostCommands } from '../src/commands/posts.ts'
import { PostQueries } from '../src/queries/posts.ts'
import { MediaStorage, mediaKeys } from '../src/services/media-storage.ts'
import { capture, defined, makeTestApp, type TestApp } from './app.ts'

const app = makeTestApp()
const posts = () => app.run(Effect.flatMap(PostQueries, (queries) => queries.all))

beforeAll(app.seedMedia)
beforeEach(app.seedDatabase)
afterAll(app.dispose)

describe('the home page', () => {
  it('renders every post, newest first', async () => {
    let response = await app.fetch('/')
    let html = await response.text()
    let dates = [...html.matchAll(/<time datetime="([^"]+)"/g)].map(([, date = '']) =>
      Date.parse(date),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expect(dates.length).toBe((await posts()).length)
    expect(dates).toEqual(dates.toSorted((a, b) => b - a))
    expect(html).toMatch(/<link rel="canonical" href="https:\/\/example\.com\/"/)
  })

  it('shows the site config’s title, description, and introduction', async () => {
    let html = await (await app.fetch('/')).text()
    expect(html).toMatch(/<title>Test Site<\/title>/)
    expect(html).toMatch(/<meta name="description" content="Posts for testing\.">/)
    expect(html).toMatch(/<meta property="og:site_name" content="Test Site">/)
    expect(html).toMatch(/<h1>Hi, I’m a test!<\/h1><p>I check that things work\.<\/p>/)
  })

  it('preloads the first post’s photo first, and loads Datastar last, at a low priority', async () => {
    let html = await (await app.fetch('/')).text()
    let head = html.slice(0, html.indexOf('</head>'))
    let preload = head.match(/<link rel="preload" as="image"[^>]*>/)?.[0] ?? ''
    // Before the inlined stylesheet, with the same copies and sizes as the photo's <img>.
    expect(preload).not.toBe('')
    expect(head.indexOf(preload)).toBeLessThan(head.indexOf('<style'))
    let img = html.match(/<img [^>]*hike-1\.jpg[^>]*>/)?.[0] ?? ''
    expect(preload.match(/ imagesrcset="([^"]+)"/)?.[1]).toBe(img.match(/ srcset="([^"]+)"/)?.[1])
    expect(preload.match(/ imagesizes="([^"]+)"/)?.[1]).toBe(img.match(/ sizes="([^"]+)"/)?.[1])
    expect(preload).toMatch(/ fetchpriority="high"/)
    // The only script runs nothing until the page has been parsed, and only with the nonce.
    expect(head).not.toMatch(/<script (?!type="application\/ld\+json")/)
    let nonce = html.match(/<html [^>]*data-nonce="([^"]+)"/)?.[1]
    expect(html).toMatch(
      new RegExp(
        `<script type="module" src="/assets/datastar\\.[0-9a-f]{12}\\.js" nonce="${nonce}" fetchpriority="low"></script></body>`,
      ),
    )

    // A post's page preloads its own first photo; a text post has nothing to preload.
    let photos = await (await app.fetch('/posts/drdp3ei6fd')).text()
    expect(photos).toMatch(
      /<link rel="preload" as="image" href="\/posts\/drdp3ei6fd\/hike-1\.jpg\?v=/,
    )
    let text = await (await app.fetch('/posts/xf6ddthtoo')).text()
    expect(text).not.toMatch(/rel="preload" as="image"/)
  })

  it('links to the RSS feed from every page', async () => {
    let html = await (await app.fetch('/')).text()
    expect(html).toMatch(
      /<link rel="alternate" type="application\/rss\+xml"[^>]*href="https:\/\/example\.com\/rss\.xml"/,
    )
    expect(html).toMatch(/<a href="\/rss\.xml" aria-label="RSS feed"/)
  })

  it('inlines the stylesheet, with its imports joined and the heading font embedded', async () => {
    let html = await (await app.fetch('/')).text()
    let style = html.match(/<style>(.*?)<\/style>/s)?.[1] ?? ''
    expect(style).not.toMatch(/@import/)
    expect(style).toMatch(/^@layer reset,theme,components;/)
    expect(style).toMatch(/font-family:'Instrument Sans'/)
    expect(style).toMatch(/url\("data:font\/woff2;base64,/)
    expect(style).not.toMatch(/instrument-sans-latin-600\.woff2/)
    // Admin styles are only on admin pages.
    expect(style).not.toMatch(/\.admin-page/)
    expect(html).not.toMatch(/rel="stylesheet"/)
  })

  it('sends security headers, and a CSP that only lets Datastar run, with this response’s nonce', async () => {
    let page = await app.fetch('/')
    let html = await page.text()
    let nonce = html.match(/data-nonce="([^"]+)"/)?.[1]
    expect(page.headers.get('X-Frame-Options')).toBe('DENY')
    expect(page.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin')
    expect(page.headers.get('Strict-Transport-Security')).toMatch(/max-age=\d+/)
    let csp = page.headers.get('Content-Security-Policy') ?? ''
    expect(csp).toContain(`script-src 'nonce-${nonce}';`)
    expect(csp).toContain("require-trusted-types-for 'script'")
    expect(csp).toContain("frame-ancestors 'none'")
    // A new nonce every time.
    let again = await (await app.fetch('/')).text()
    expect(again.match(/data-nonce="([^"]+)"/)?.[1]).not.toBe(nonce)
  })

  it('caches fonts and Datastar for a year, and runs no scripts in other responses', async () => {
    let html = await (await app.fetch('/')).text()
    let datastar = await app.fetch(capture(html, /src="(\/assets\/datastar\.[^"]+)"/))
    expect(datastar.status).toBe(200)
    expect(datastar.headers.get('Content-Type')).toBe('text/javascript; charset=utf-8')
    expect(datastar.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    let font = await app.fetch('/fonts/instrument-sans-latin-ext-600.woff2')
    expect(font.status).toBe(200)
    expect(font.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(font.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(font.headers.get('Content-Security-Policy')).toContain("script-src 'none'")
    expect((await app.fetch('/assets/datastar.000000000000.js')).status).toBe(404)
  })

  it('wraps user content so Datastar ignores it, and keeps expressions free of it', async () => {
    let id = 'xss0000000'
    let caption = 'Hi <b data-on:click="alert(1)">there</b> data-on:click="alert(2)"'
    await app.run(
      Effect.flatMap(PostCommands, (commands) =>
        commands.publish({
          post: { id, type: 'text', date: '2000-01-01T00:00:00Z', caption },
          uploads: [],
          issues: [],
        }),
      ),
    )
    let html = await (await app.fetch(`/posts/${id}`)).text()
    expect(html).toContain(
      '<div class="caption" data-ignore><p>Hi &lt;b data-on:click="alert(1)"&gt;there&lt;/b&gt;',
    )
    expect(html).not.toMatch(/<b data-on/)
  })
})

describe('feeds and files for machines', () => {
  it('sitemap.xml lists the home page and every post', async () => {
    let response = await app.fetch('/sitemap.xml')
    let xml = await response.text()
    expect(response.headers.get('Content-Type')).toBe('application/xml; charset=utf-8')
    expect(xml).toMatch(/<loc>https:\/\/example\.com\/<\/loc>/)
    for (let post of await posts()) {
      expect(xml).toMatch(new RegExp(`<loc>https://example\\.com/posts/${post.id}</loc>`))
    }
  })

  it('rss.xml has every post, with its content and absolute URLs', async () => {
    let response = await app.fetch('/rss.xml')
    expect(response.headers.get('Content-Type')).toBe('application/rss+xml; charset=utf-8')
    let xml = await response.text()
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<rss version="2.0"/)
    expect(xml).toMatch(/<atom:link href="https:\/\/example\.com\/rss\.xml" rel="self"/)
    let all = await posts()
    let items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item = '']) => item)
    expect(items.length).toBe(all.length)
    for (let [i, post] of all.entries()) {
      let url = `https://example.com/posts/${post.id}`
      expect(items[i]).toContain(`<guid isPermaLink="true">${url}</guid>`)
      expect(items[i]).toContain(`<pubDate>${new Date(post.date).toUTCString()}</pubDate>`)
    }
    let html = items
      .map((item) =>
        (item.match(/<description>([\s\S]*)<\/description>/)?.[1] ?? '')
          .replaceAll('&lt;', '<')
          .replaceAll('&gt;', '>')
          .replaceAll('&quot;', '"')
          .replaceAll('&apos;', "'")
          .replaceAll('&amp;', '&'),
      )
      .join('\n')
    expect(html).not.toMatch(/ (src|href|poster|srcset)="\//)
    // A text post's caption, and a photos post's photos.
    expect(html).toContain('<strong>No build step</strong>')
    expect(html).toMatch(/<img src="https:\/\/example\.com\/posts\/drdp3ei6fd\/hike-1\.jpg\?v=/)
    expect(html).toMatch(/<video src="https:\/\/example\.com\/posts\/steq6e0rsh\/flower\.mp4"/)
  })

  it('site.webmanifest is named after the site', async () => {
    let response = await app.fetch('/site.webmanifest')
    expect(response.headers.get('Content-Type')).toMatch(/application\/manifest\+json/)
    let manifest = Schema.decodeUnknownSync(
      Schema.Struct({ name: Schema.String, icons: Schema.Array(Schema.Unknown) }),
    )(await response.json())
    expect(manifest.name).toBe('Test Site')
    expect(manifest.icons.length).toBe(2)
  })

  it('robots.txt points to the sitemap', async () => {
    expect(await (await app.fetch('/robots.txt')).text()).toMatch(
      /Sitemap: https:\/\/example\.com\/sitemap\.xml/,
    )
  })

  it('serves LogSpace’s icons until one is uploaded', async () => {
    for (let path of [
      '/favicon.ico',
      '/apple-touch-icon.png',
      '/site/icon-192.png',
      '/site/icon-512.png',
    ]) {
      let response = await app.fetch(path)
      expect(response.status).toBe(200)
      await response.body?.cancel()
    }
    expect((await app.fetch('/site/favicon.ico')).status).toBe(404)
    expect((await app.fetch('/site/logo.webp')).status).toBe(404)
  })

  it('answers unknown paths with a 404', async () => {
    let response = await app.fetch('/no-such-page')
    expect(response.status).toBe(404)
    expect((await app.fetch('/posts/drdp3ei6fd/')).status).toBe(404)
    expect((await app.fetch(`/posts/${'a'.repeat(3000)}`)).status).toBe(404)
    expect(response.headers.get('X-Frame-Options')).toBe('DENY')
  })
})

describe('a post’s page and files', () => {
  it('renders each post with its SEO tags', async () => {
    for (let post of await posts()) {
      let response = await app.fetch(`/posts/${post.id}`)
      let html = await response.text()
      expect(response.status).toBe(200)
      expect(html).toContain(`<link rel="canonical" href="https://example.com/posts/${post.id}">`)
      expect(html).toMatch(/<meta property="og:type" content="article">/)
      expect(html).toMatch(/<script type="application\/ld\+json">/)
    }
  })

  it('renders a caption’s bold, italic, and links', async () => {
    let html = await (await app.fetch('/posts/xf6ddthtoo')).text()
    expect(html).toContain(
      '<div class="caption" data-ignore><p>Rebuilt this site on Remix 3 over the weekend. ' +
        '<strong>No build step</strong>, Web APIs everywhere, and the whole page ships ' +
        '<em>almost no</em> JavaScript.</p>\n' +
        '<p><a target="_blank" rel="noopener" href="https://remix.run">remix.run</a></p></div>',
    )
  })

  it('renders a caption whose link is malformed, without a preview', async () => {
    let id = 'badlink000'
    let caption = 'Broken: https://[bad-host] but https://remix.run is fine'
    await app.run(
      Effect.flatMap(PostCommands, (commands) =>
        commands.publish({
          post: { id, type: 'text', date: '2000-01-01T00:00:00Z', caption },
          uploads: [],
          issues: [],
        }),
      ),
    )
    expect((await app.fetch('/')).status).toBe(200)
    let response = await app.fetch(`/posts/${id}`)
    let html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toMatch(/Broken: https:\/\/\[bad-host\]/)
    expect(html).not.toMatch(/href="https:\/\/\[bad-host\]"/)
    // The preview card is for the first link that's a real URL.
    expect(html).toMatch(
      /<a href="https:\/\/remix\.run" target="_blank" rel="noopener" class="media-frame link-card"/,
    )
  })

  it('is a 404 for unknown posts', async () => {
    let response = await app.fetch('/posts/no-such-post')
    expect(response.status).toBe(404)
    expect(await response.text()).toMatch(/<meta name="robots" content="noindex">/)
  })

  it('serves media, with range requests and revalidation', async () => {
    let video = defined(
      (await posts()).find((post) => post.type === 'video'),
      'a video post',
    )
    if (video.type !== 'video') throw new Error('No video post')
    let response = await app.fetch(video.video.src)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('video/mp4')
    expect(response.headers.get('Cache-Control')).toMatch(/max-age/)
    let etag = defined(response.headers.get('ETag'), 'an ETag')
    await response.body?.cancel()

    let partial = await app.fetch(video.video.src, { headers: { Range: 'bytes=0-99' } })
    expect(partial.status).toBe(206)
    expect(partial.headers.get('Content-Range')).toMatch(/^bytes 0-99\/\d+$/)
    expect((await partial.arrayBuffer()).byteLength).toBe(100)

    let unchanged = await app.fetch(video.video.src, { headers: { 'If-None-Match': etag } })
    expect(unchanged.status).toBe(304)
    let head = await app.fetch(video.video.src, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect((await head.arrayBuffer()).byteLength).toBe(0)
  })

  it('sizes photos and links to their resized copies, which are cached for good', async () => {
    let post = defined(
      (await posts()).find((post) => post.type === 'photos'),
      'a photos post',
    )
    if (post.type !== 'photos') throw new Error('No photos post')
    let html = await (await app.fetch('/')).text()
    let img = html.match(/<img [^>]*hike-1\.jpg[^>]*>/)?.[0] ?? ''
    expect(img).toMatch(/ width="32" height="21"/)
    expect(img).toMatch(/ sizes="[^"]+"/)
    let srcset = img.match(/ srcset="([^"]+)"/)?.[1] ?? ''
    let [url = '', descriptor] = srcset.replaceAll('&amp;', '&').split(' ')
    expect(url).toMatch(/^\/posts\/drdp3ei6fd\/hike-1\.jpg\?w=320&v=[0-9a-f]{12}$/)
    expect(descriptor).toBe('32w')

    // Concurrent requests for a copy that isn't made yet share one resize.
    let [resized, again] = await Promise.all([app.fetch(url), app.fetch(url)])
    expect(resized.headers.get('Content-Type')).toBe('image/webp')
    expect(resized.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(new Uint8Array(await resized.arrayBuffer())).toEqual(
      new Uint8Array(await again.arrayBuffer()),
    )

    let original = await app.fetch(post.photos[0].src)
    expect(original.headers.get('Content-Type')).toBe('image/jpeg')
    expect(original.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    await original.body?.cancel()

    // An old version isn't kept for good, and has no resized copies.
    let old = await app.fetch('/posts/drdp3ei6fd/hike-1.jpg?v=000000000000')
    expect(old.headers.get('Cache-Control')).toBe('public, max-age=3600')
    await old.body?.cancel()
    expect((await app.fetch('/posts/drdp3ei6fd/hike-1.jpg?w=320&v=000000000000')).status).toBe(404)
  })

  it('gives a video without a size its poster’s', async () => {
    let id = 'steq6e0rsh'
    let result = await app.run(
      Effect.gen(function* () {
        let queries = yield* PostQueries
        let record = yield* queries.findRecord(id)
        if (record?.type !== 'video') throw new Error('No video post')
        let { width: _, height: __, ...video } = record.video
        yield* (yield* PostCommands).edit(id, {
          post: { ...record, video },
          uploads: [],
          issues: [],
        })
        return yield* queries.find(id)
      }),
    )
    if (result?.type !== 'video') throw new Error('No video post')
    expect(result.video.width).toBe(64)
    expect(result.video.height).toBe(36)
    expect(result.video.poster).toMatch(/poster\.jpg\?w=320&v=/)
    expect(result.video.posterImage).toMatch(/poster\.jpg\?v=/)
  })

  it('only serves files of published posts', async () => {
    let post = defined((await posts())[0], 'a post')
    for (let path of [
      '/posts/no-such-post/photo.jpg',
      `/posts/${post.id}/missing.jpg`,
      `/posts/${post.id}/..%2F..%2Fposts.json`,
      `/posts/${post.id}/.hidden`,
    ]) {
      expect([path, (await app.fetch(path)).status]).toEqual([path, 404])
    }
  })
})

describe('link previews', () => {
  // A cache with the test post's link already fetched, since the tests don't reach the network.
  const cacheDir = `/tmp/logspace2-link-previews-${process.pid}`
  const version = 'ddab006048d1'
  // Made once the cache is written, since it's read when the app starts.
  let linked: TestApp
  const textPost = async () =>
    defined(
      (await linked.run(Effect.flatMap(PostQueries, (queries) => queries.all))).find(
        (post) => post.type === 'text' && post.caption.includes('https://remix.run'),
      ),
      'the post linking remix.run',
    )

  beforeAll(async () => {
    await Bun.write(
      `${cacheDir}/link-previews.json`,
      JSON.stringify({
        'https://remix.run': {
          fetchedAt: Date.now(),
          metadata: { title: 'Remix', image: 'https://remix.run/share.jpg' },
          image: { width: 500, height: 262, version },
        },
      }),
    )
    linked = makeTestApp({ cacheDir })
    await linked.run(
      Effect.flatMap(MediaStorage, (storage) =>
        storage.put(mediaKeys.linkImage(`${version}-320.webp`), new Uint8Array([1, 2, 3])),
      ),
    )
  })
  beforeEach(() => linked.seedDatabase())
  afterAll(async () => {
    await linked.dispose()
    await fsp.rm(cacheDir, { recursive: true, force: true })
  })

  it('shows the link’s image from its saved copies, not the other site', async () => {
    let html = await (await linked.fetch(`/posts/${(await textPost()).id}`)).text()
    expect(html).toContain(
      `<img src="/link-images/${version}-600.webp" srcset="/link-images/${version}-320.webp 320w, ` +
        `/link-images/${version}-400.webp 400w, /link-images/${version}-480.webp 480w, ` +
        `/link-images/${version}-600.webp 500w" sizes="(min-width: 38rem) 36rem, calc(100vw - 2rem)" ` +
        `alt="" width="500" height="262" loading="lazy" decoding="async" class="card-image">`,
    )
    expect(html).not.toContain('https://remix.run/share.jpg')
  })

  it('serves the saved copies for good, and nothing else', async () => {
    let response = await linked.fetch(`/link-images/${version}-320.webp`)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/webp')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    for (let name of [`${version}-400.webp`, 'ddab00604-320.webp', '..%2Fsite%2Flogo.png']) {
      expect((await linked.fetch(`/link-images/${name}`)).status).toBe(404)
    }
  })

  it('shows a card without an image until its copies are saved', async () => {
    // The shared app's cache has no copies for this link.
    let html = await (await app.fetch(`/posts/${(await textPost()).id}`)).text()
    expect(html).toMatch(/class="media-frame link-card"><div class="card-text">/)
  })
})
