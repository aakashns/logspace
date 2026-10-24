// A post's page and files.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { Effect } from 'effect'

import { defined, makeTestApp } from '../../../test/app.ts'
import { PostCommands } from '../../data/posts/commands.ts'
import { PostQueries } from '../../data/posts/queries.ts'

const app = makeTestApp()
const posts = () => app.run(Effect.flatMap(PostQueries, (queries) => queries.all))

beforeAll(app.seedMedia)
beforeEach(app.seedDatabase)
afterAll(app.dispose)

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

  it('serves a post’s page with a trailing slash too', async () => {
    let response = await app.fetch('/posts/xf6ddthtoo/')
    expect(response.status).toBe(200)
    expect(await response.text()).toContain(
      '<link rel="canonical" href="https://example.com/posts/xf6ddthtoo">',
    )
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
        commands.save({
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
        yield* (yield* PostCommands).save({
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
