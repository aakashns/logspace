import * as assert from 'remix/assert'
import { beforeAll, beforeEach, describe, it } from 'remix/test'

import { fetch } from '../../test/client.ts'
import { seedDatabase, seedMedia } from '../../test/seed.ts'
import { createPost, updatePost } from '../data/posts/mutations.ts'
import { getPost, getPostRecord, getPosts } from '../data/posts/store.ts'
import { routes } from '../routes.ts'

// bun run test uses an in-memory database and media storage; fill them with the test posts and files.
beforeAll(seedMedia)
beforeEach(seedDatabase)

describe('root controller', () => {
  it('GET / renders every post, newest first', async () => {
    let response = await fetch(routes.home.href())
    let html = await response.text()
    let dates = [...html.matchAll(/<time datetime="([^"]+)"/gi)].map((match) =>
      Date.parse(match[1]),
    )

    assert.equal(response.status, 200)
    assert.match(response.headers.get('Content-Type') ?? '', /text\/html/)
    assert.equal(dates.length, (await getPosts()).length)
    assert.deepEqual(
      dates,
      dates.toSorted((a, b) => b - a),
    )
    assert.match(html, /<link [^>]*rel="canonical" href="https:\/\/example\.com\/"/)
  })

  it('GET /sitemap.xml lists the home page and every post', async () => {
    let response = await fetch(routes.sitemap.href())
    let xml = await response.text()

    assert.match(response.headers.get('Content-Type') ?? '', /application\/xml/)
    assert.match(xml, /<loc>https:\/\/example\.com\/<\/loc>/)
    for (let post of await getPosts()) {
      assert.match(xml, new RegExp(`<loc>https://example\\.com/posts/${post.id}</loc>`))
    }
  })

  it('GET /rss.xml has every post, with its content and absolute URLs', async () => {
    let response = await fetch(routes.rss.href())
    assert.equal(response.headers.get('Content-Type'), 'application/rss+xml; charset=utf-8')
    let xml = await response.text()
    assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<rss version="2.0"/)
    assert.match(xml, /<atom:link href="https:\/\/example\.com\/rss\.xml" rel="self"/)
    let all = await getPosts()
    let items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1])
    assert.equal(items.length, all.length)
    for (let [i, post] of all.entries()) {
      let url = `https://example.com/posts/${post.id}`
      assert.match(items[i], new RegExp(`<guid isPermaLink="true">${url}</guid>`))
      assert.match(items[i], new RegExp(`<pubDate>${new Date(post.date).toUTCString()}</pubDate>`))
    }
    let descriptions = items.map((item) =>
      (item.match(/<description>([\s\S]*)<\/description>/)?.[1] ?? '')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&apos;', "'")
        .replaceAll('&amp;', '&'),
    )
    let html = descriptions.join('\n')
    assert.doesNotMatch(html, / (src|href|poster|srcset)="\//)
    // An article's whole body, and a photos post's photos.
    assert.match(html, /<h2[^>]*>Small releases beat big launches<\/h2>/)
    assert.match(html, /<img src="https:\/\/example\.com\/posts\/drdp3ei6fd\/hike-1\.jpg\?v=/)
    assert.match(html, /<video src="https:\/\/example\.com\/posts\/steq6e0rsh\/flower\.mp4"/)
  })

  it('preloads the first post’s photo first, and starts the scripts once the page has loaded', async () => {
    let html = await (await fetch(routes.home.href())).text()
    let head = html.slice(0, html.indexOf('</head>'))
    let preload = head.match(/<link [^>]*rel="preload" as="image"[^>]*>/)?.[0] ?? ''
    // Before the inlined stylesheet, with the same copies and sizes as the photo's <img>.
    assert.ok(head.indexOf(preload) < head.indexOf('<style'))
    let img = html.match(/<img [^>]*hike-1\.jpg[^>]*>/)?.[0] ?? ''
    let srcset = img.match(/ srcset="([^"]+)"/)?.[1]
    assert.equal(preload.match(/ imagesrcset="([^"]+)"/)?.[1], srcset)
    assert.equal(preload.match(/ imagesizes="([^"]+)"/)?.[1], img.match(/ sizes="([^"]+)"/)?.[1])
    assert.match(preload, / fetchpriority="high"/)
    // The entry and its modules aren't fetched until the load event (Remix's preloads for the
    // client entries stay).
    assert.doesNotMatch(head, /<script [^>]*type="module"/)
    assert.doesNotMatch(head, /<link (?![^>]*data-rmx-module-preload)[^>]*rel="modulepreload"/)
    assert.match(head, /<script data-rmx-key="script:entry">addEventListener\('load'/)

    // A post's page preloads its own first photo; a text post has nothing to preload.
    let photos = await (await fetch(routes.posts.show.href({ id: 'drdp3ei6fd' }))).text()
    assert.match(
      photos,
      /<link [^>]*rel="preload" as="image" href="\/posts\/drdp3ei6fd\/hike-1\.jpg\?v=/,
    )
    let text = await (await fetch(routes.posts.show.href({ id: 'xf6ddthtoo' }))).text()
    assert.doesNotMatch(text, /rel="preload" as="image"/)
  })

  it('links to the RSS feed from every page', async () => {
    let html = await (await fetch(routes.home.href())).text()
    assert.match(
      html,
      /<link [^>]*rel="alternate" type="application\/rss\+xml"[^>]*href="https:\/\/example\.com\/rss\.xml"/,
    )
    assert.match(html, /<a href="\/rss\.xml" aria-label="RSS feed" data-rmx-document/)
  })

  it('GET / inlines the global stylesheet with its imports flattened', async () => {
    let html = await (await fetch(routes.home.href())).text()
    let style = html.match(/<style data-rmx-key="stylesheet:global"[^>]*>(.*?)<\/style>/s)?.[1]

    assert.ok(style)
    assert.doesNotMatch(style, /@import/)
    assert.match(style, /@layer reset,theme,rmx;/)
    assert.match(style, /font-family:Instrument Sans/)
    assert.match(style, /url\("data:font\/woff2;base64,/)
    assert.doesNotMatch(style, /instrument-sans-latin-600\.woff2/)
    assert.doesNotMatch(html, /rel="stylesheet"/)
  })

  it('sends security headers and caches fonts for a year', async () => {
    let page = await fetch(routes.home.href())
    let font = await fetch('/fonts/instrument-sans-latin-ext-600.woff2')

    assert.equal(page.headers.get('X-Frame-Options'), 'DENY')
    assert.equal(page.headers.get('Cross-Origin-Opener-Policy'), 'same-origin')
    assert.match(page.headers.get('Strict-Transport-Security') ?? '', /max-age=\d+/)
    assert.equal(font.status, 200)
    assert.equal(font.headers.get('Cache-Control'), 'public, max-age=31536000, immutable')
    assert.equal(font.headers.get('X-Content-Type-Options'), 'nosniff')
  })

  it('GET / shows the site config’s title, description, and introduction', async () => {
    let html = await (await fetch(routes.home.href())).text()
    assert.match(html, /<title>Test Site<\/title>/)
    assert.match(html, /<meta [^>]*name="description" content="Posts for testing\."/)
    assert.match(html, /<meta [^>]*property="og:site_name" content="Test Site"/)
    assert.match(html, /<h1>Hi, I’m a test!<\/h1>\s*<p>I check that things work\.<\/p>/)
  })

  it('GET /site.webmanifest is named after the site', async () => {
    let response = await fetch(routes.manifest.href())
    assert.match(response.headers.get('Content-Type') ?? '', /application\/manifest\+json/)
    let manifest = await response.json()
    assert.equal(manifest.name, 'Test Site')
    assert.equal(manifest.icons.length, 3)
  })

  it('GET /robots.txt points to the sitemap', async () => {
    assert.match(
      await (await fetch('/robots.txt')).text(),
      /Sitemap: https:\/\/example\.com\/sitemap\.xml/,
    )
  })
})

describe('posts controller', () => {
  it('GET /posts/:id renders each post with its SEO tags', async () => {
    for (let post of await getPosts()) {
      let response = await fetch(routes.posts.show.href({ id: post.id }))
      let html = await response.text()

      assert.equal(response.status, 200, post.id)
      assert.match(
        html,
        new RegExp(`<link [^>]*rel="canonical" href="https://example.com/posts/${post.id}"`),
      )
      assert.match(html, /<meta [^>]*property="og:type" content="article"/)
      assert.match(html, /<script [^>]*type="application\/ld\+json">/)
    }
  })

  it('GET /posts/:id renders an article body', async () => {
    let article = (await getPosts()).find((post) => post.type === 'article')!
    let html = await (await fetch(routes.posts.show.href({ id: article.id }))).text()
    assert.match(html, /<h2[^>]*>/)
    // notebook.mp4's poster is notebook.jpg, found in media storage.
    assert.match(
      html,
      new RegExp(
        `<video src="/posts/${article.id}/notebook\\.mp4" poster="/posts/${article.id}/notebook\\.jpg"`,
      ),
    ) // Its photos are sized, with resized copies.
    assert.match(
      html,
      new RegExp(
        `<img src="/posts/${article.id}/desk\\.jpg\\?v=[0-9a-f]{12}" srcset="[^"]+ 32w" sizes="[^"]+" width="32" height="21" alt="My desk on a typical Tuesday" loading="lazy"`,
      ),
    )
  })

  it('renders a caption whose link is malformed, without a preview', async () => {
    let id = 'badlink000'
    let caption = 'Broken: https://[bad-host] but https://remix.run is fine'
    let post = { id, type: 'text', date: '2000-01-01T00:00:00Z', caption }
    await createPost({ post, uploads: [], issues: [] })
    let home = await fetch(routes.home.href())
    assert.equal(home.status, 200)
    let response = await fetch(routes.posts.show.href({ id }))
    let html = await response.text()
    assert.equal(response.status, 200)
    assert.match(html, /Broken: https:\/\/\[bad-host\]/)
    assert.doesNotMatch(html, /href="https:\/\/\[bad-host\]"/)
    // The preview card is for the first link that's a real URL.
    assert.match(html, /<a [^>]*href="https:\/\/remix\.run"/)
  })

  it('GET /posts/:id is a 404 for unknown posts', async () => {
    let response = await fetch(routes.posts.show.href({ id: 'no-such-post' }))
    assert.equal(response.status, 404)
    assert.match(await response.text(), /<meta [^>]*name="robots" content="noindex"/)
  })

  it('GET /posts/:id/:file serves media, with range requests', async () => {
    let video = (await getPosts()).find((post) => post.type === 'video')!
    if (video.type !== 'video') throw new Error('No video post')

    let response = await fetch(video.video.src)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Content-Type'), 'video/mp4')
    assert.match(response.headers.get('Cache-Control') ?? '', /max-age/)
    await response.body?.cancel()

    let partial = await fetch(video.video.src, { headers: { Range: 'bytes=0-99' } })
    assert.equal(partial.status, 206)
    assert.equal((await partial.arrayBuffer()).byteLength, 100)
  })

  it('sizes photos and links to their resized copies, which are cached for good', async () => {
    let post = (await getPosts()).find((post) => post.type === 'photos')!
    if (post.type !== 'photos') throw new Error('No photos post')
    let html = await (await fetch(routes.home.href())).text()
    let img = html.match(/<img [^>]*hike-1\.jpg[^>]*>/)?.[0] ?? ''
    assert.match(img, / width="32" height="21"/)
    assert.match(img, / sizes="[^"]+"/)
    let srcset = img.match(/ srcset="([^"]+)"/)?.[1] ?? ''
    let [url, descriptor] = srcset.replaceAll('&amp;', '&').split(' ')
    assert.match(url, /^\/posts\/drdp3ei6fd\/hike-1\.jpg\?w=320&v=[0-9a-f]{12}$/)
    assert.equal(descriptor, '32w')

    let resized = await fetch(url)
    assert.equal(resized.headers.get('Content-Type'), 'image/webp')
    assert.equal(resized.headers.get('Cache-Control'), 'public, max-age=31536000, immutable')
    await resized.body?.cancel()

    let original = await fetch(post.photos[0].src)
    assert.equal(original.headers.get('Content-Type'), 'image/jpeg')
    assert.equal(original.headers.get('Cache-Control'), 'public, max-age=31536000, immutable')
    await original.body?.cancel()

    // An old version isn't kept for good, and has no resized copies.
    let old = await fetch('/posts/drdp3ei6fd/hike-1.jpg?v=000000000000')
    assert.equal(old.headers.get('Cache-Control'), 'public, max-age=3600')
    await old.body?.cancel()
    assert.equal((await fetch('/posts/drdp3ei6fd/hike-1.jpg?w=320&v=000000000000')).status, 404)
  })

  it('gives a video without a size its poster’s', async () => {
    let id = 'steq6e0rsh'
    let record = await getPostRecord(id)
    assert.ok(record?.type === 'video' && record.video.width && record.video.height)
    let edited = { ...record, video: { ...record.video, width: undefined, height: undefined } }
    await updatePost(id, { post: edited, uploads: [], issues: [] })
    let post = await getPost(id)
    assert.ok(post?.type === 'video')
    assert.equal(post.video.width, 64)
    assert.equal(post.video.height, 36)
    assert.match(post.video.poster ?? '', /poster\.jpg\?w=320&v=/)
    assert.match(post.video.posterImage ?? '', /poster\.jpg\?v=/)
  })

  it('GET /posts/:id/:file only serves files of published posts', async () => {
    let [post] = await getPosts()
    for (let path of [
      `/posts/no-such-post/photo.jpg`,
      `/posts/${post.id}/missing.jpg`,
      `/posts/${post.id}/..%2F..%2Fposts.json`,
      `/posts/${post.id}/.hidden`,
    ]) {
      assert.equal((await fetch(path)).status, 404, path)
    }
  })
})
