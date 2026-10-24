// Link previews' cards on pages, and their images.
import * as fsp from 'node:fs/promises'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { Effect } from 'effect'

import { defined, makeTestApp, type TestApp } from '../../../test/app.ts'
import { MediaStorage, mediaKeys } from '../../lib/media-storage.ts'
import { PostQueries } from '../queries.ts'

const app = makeTestApp()

beforeAll(app.seedMedia)
beforeEach(app.seedDatabase)
afterAll(app.dispose)

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
