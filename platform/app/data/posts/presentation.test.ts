import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { parsePostRecords } from './model.ts'
import { getPostMeta, toPost } from './presentation.ts'

const ID = 'fc7p7vjhx6'
const DATE = '2026-10-16T18:42:00+05:30'

describe('toPost', () => {
  it('gives photos URLs, and the size and resized copies of those it knows', () => {
    let photos = [
      { file: 'a b.jpg', alt: 'A' },
      { file: 'c.jpg', alt: 'C' },
    ]
    let [record] = parsePostRecords([{ id: ID, type: 'photos', date: DATE, photos }])
    let post = toPost(record, (file) =>
      file === 'c.jpg' ? { width: 500, height: 400, version: 'v1' } : undefined,
    )
    assert.deepEqual(post.type === 'photos' && post.photos, [
      { src: `/posts/${ID}/a%20b.jpg`, alt: 'A' },
      {
        src: `/posts/${ID}/c.jpg?v=v1`,
        alt: 'C',
        width: 500,
        height: 400,
        srcset: `/posts/${ID}/c.jpg?w=320&v=v1 320w, /posts/${ID}/c.jpg?w=400&v=v1 400w, /posts/${ID}/c.jpg?w=480&v=v1 480w, /posts/${ID}/c.jpg?w=600&v=v1 500w`,
      },
    ])
  })
})

describe('getPostMeta', () => {
  it('describes a post by its caption’s first line, shortened, and the rest of it', () => {
    let caption = `${'A long first line. '.repeat(5)}\n\nMore`
    let meta = getPostMeta({ id: ID, type: 'text', date: DATE, caption })
    assert.equal(meta.title?.length, 60)
    assert.ok(meta.title?.endsWith('…'))
    assert.match(meta.description ?? '', /More$/)
    assert.deepEqual(meta.published, { date: DATE, kind: 'SocialMediaPosting' })
  })
})
