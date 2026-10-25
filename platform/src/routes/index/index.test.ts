// The home page, and what every page has.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { Effect } from 'effect'

import { capture, makeTestApp } from '../../../test/app.ts'
import { PostCommands } from '../../data/posts/commands.ts'
import { PostQueries } from '../../data/posts/queries.ts'

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
    expect(html).toMatch(/<a [^>]*href="\/rss\.xml" aria-label="RSS feed"/)
  })

  it('inlines every page’s styles, with the heading font embedded, and its own', async () => {
    let html = await (await app.fetch('/')).text()
    let style = html.match(/<style>(.*?)<\/style>/s)?.[1] ?? ''
    expect(style).toMatch(/^@layer reset,theme,ui,components;/)
    expect(style).toMatch(/font-family:'Instrument Sans'/)
    expect(style).toMatch(/url\("data:font\/woff2;base64,/)
    expect(style).not.toMatch(/instrument-sans-latin-600\.woff2/)
    expect(style).toMatch(/\.feed-post\{/)
    expect(style).toMatch(/\.banner\{/)
    // Other pages' styles are only on those pages.
    expect(style).not.toMatch(/\.post-page\{/)
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
        commands.save({
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
