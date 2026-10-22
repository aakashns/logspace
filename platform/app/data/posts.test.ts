import * as assert from 'remix/assert'
import { createMemoryFileStorage } from 'remix/file-storage/memory'
import { describe, it } from 'remix/test'

import { readTestPosts, seedMedia } from '../../test/seed.ts'
import { findMissingPostFiles, parsePosts } from './posts.ts'

// The sample posts the other tests use.
describe('test content', () => {
  it('has valid posts, newest first', async () => {
    let times = (await readTestPosts()).map((post) => Date.parse(post.date))
    assert.ok(times.length > 0)
    assert.deepEqual(
      times,
      times.toSorted((a, b) => b - a),
    )
  })

  it('has every file its posts mention', async () => {
    let storage = createMemoryFileStorage()
    await seedMedia(storage)
    let missing = await Promise.all(
      (await readTestPosts()).map(async (post) =>
        (await findMissingPostFiles(post, storage)).map((file) => `${post.id}/${file}`),
      ),
    )
    assert.deepEqual(missing.flat(), [])
  })
})

describe('parsePosts', () => {
  const ID = 'fc7p7vjhx6'
  const OLDER = 'drdp3ei6fd'
  const NEWER = 'steq6e0rsh'

  let text = { id: ID, type: 'text', date: '2026-10-16T18:42:00+05:30', caption: 'Hi' }

  it('resolves media file names to URLs', () => {
    let [post] = parsePosts([{ ...text, type: 'photos', photos: [{ file: 'a b.jpg', alt: 'A' }] }])
    assert.equal(post.type === 'photos' && post.photos[0].src, `/posts/${ID}/a%20b.jpg`)
  })

  it('sorts posts newest first', () => {
    let posts = parsePosts([
      { ...text, id: OLDER, date: '2026-10-01T09:00:00Z' },
      { ...text, id: NEWER, date: '2026-10-02T09:00:00Z' },
    ])
    assert.deepEqual(
      posts.map((post) => post.id),
      [NEWER, OLDER],
    )
  })

  it('names the post and field that are wrong', () => {
    let invalid = (posts: unknown[], message: RegExp) =>
      assert.throws(() => parsePosts(posts), { message })

    invalid([{ ...text, id: 'my-first-post' }], /Expected 10 lowercase letters and digits/)
    invalid([{ ...text, id: ID.toUpperCase() }], /Expected 10 lowercase letters and digits/)
    invalid([{ ...text, date: '2026-10-16' }], new RegExp(`post "${ID}", date: Expected a date`))
    invalid([{ ...text, caption: ' ' }], /Text posts need a caption/)
    invalid([{ ...text, type: 'poll' }], new RegExp(`post "${ID}"`))
    invalid([{ ...text, id: 42 }], /post #1, id/)
    invalid([text, text], /unique id/)
    invalid([{ ...text, type: 'photos', photos: [] }], /at least one photo/)
    invalid(
      [{ ...text, type: 'video', video: { file: '../secret.mp4' } }],
      new RegExp(`post "${ID}", video\\.file: Expected the name of one of the post’s files`),
    )
  })
})
