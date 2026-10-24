// sitemap.xml and rss.xml.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { Effect } from 'effect'

import { makeTestApp } from '../../../test/app.ts'
import { PostQueries } from '../queries.ts'

const app = makeTestApp()
const posts = () => app.run(Effect.flatMap(PostQueries, (queries) => queries.all))

beforeAll(app.seedMedia)
beforeEach(app.seedDatabase)
afterAll(app.dispose)

describe('feeds', () => {
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
})
