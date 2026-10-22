import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { isUploadableFileName, parsePostRecord, parsePostRecords } from './model.ts'

const ID = 'fc7p7vjhx6'
let text = { id: ID, type: 'text', date: '2026-10-16T18:42:00+05:30', caption: 'Hi' }

describe('parsePostRecords', () => {
  it('names the post and field that are wrong', () => {
    let invalid = (posts: unknown[], message: RegExp) =>
      assert.throws(() => parsePostRecords(posts), { message })

    invalid([{ ...text, id: 'my-first-post' }], /Expected 10 lowercase letters and digits/)
    invalid([{ ...text, id: ID.toUpperCase() }], /Expected 10 lowercase letters and digits/)
    invalid([{ ...text, date: '2026-10-16' }], new RegExp(`post "${ID}", date: Expected a date`))
    invalid([{ ...text, caption: ' ' }], /Text posts need a caption/)
    invalid([{ ...text, type: 'poll' }], new RegExp(`post "${ID}"`))
    invalid([{ ...text, id: 42 }], /post #1, id/)
    invalid([{ ...text, type: 'photos', photos: [] }], /at least one photo/)
    invalid(
      [{ ...text, type: 'video', video: { file: '../secret.mp4' } }],
      new RegExp(`post "${ID}", video\\.file: Expected the name of one of the post’s files`),
    )
  })
})

describe('parsePostRecord', () => {
  it('gives each issue’s field as a path', () => {
    let video = { ...text, type: 'video', video: { file: 'a.mp4', width: 'wide' } }
    assert.deepEqual(parsePostRecord(video), {
      success: false,
      issues: [{ field: 'video.width', message: 'Expected a size in pixels' }],
    })
  })
})

describe('isUploadableFileName', () => {
  it('allows photos and videos only', () => {
    for (let name of ['a.jpg', 'B.JPEG', 'c.png', 'd.webp', 'e.mp4', 'f.mov']) {
      assert.equal(isUploadableFileName(name), true, name)
    }
    for (let name of ['a.svg', 'b.html', 'c.txt', 'noextension', '.hidden.jpg', 'a/b.jpg']) {
      assert.equal(isUploadableFileName(name), false, name)
    }
  })
})
