// Reading the composer's form into a post.
import { describe, expect, it } from 'bun:test'

import { type PostRecord } from '../../../data/posts/post.ts'
import { composePost, composeValues, readComposeForm } from './form.ts'

const ID = 'fc7p7vjhx6'
const DATE = '2026-10-16T13:12:00Z'

describe('the composer', () => {
  let form = (fields: [string, string | File][]) => {
    let data = new FormData()
    for (let [name, value] of fields) data.append(name, value)
    return data
  }

  it('makes a photos post with file names as alt text, renaming names already taken', () => {
    let { values, uploads } = readComposeForm(
      form([
        ['caption', 'Hi\r\nthere'],
        ['photo', 'image.jpg'],
        ['image_uploads', new File(['a'], 'image.jpg')],
        ['image_uploads', new File(['b'], 'C:\\Users\\me\\My Photo.jpg')],
      ]),
      ID,
      // Stored, though no longer in the post.
      ['image-2.jpg'],
    )
    expect(uploads.map((upload) => upload.name)).toEqual(['image-3.jpg', 'My-Photo.jpg'])
    expect(composePost(values, DATE)).toEqual({
      id: ID,
      date: DATE,
      type: 'photos',
      caption: 'Hi\nthere',
      photos: [
        { file: 'image.jpg', alt: 'image.jpg' },
        { file: 'image-3.jpg', alt: 'image-3.jpg' },
        { file: 'My-Photo.jpg', alt: 'My-Photo.jpg' },
      ],
    })
  })

  it('takes photos or a video, not both, and with a video, an image as its poster', () => {
    let { values, uploads } = readComposeForm(
      form([
        ['video', 'clip.mp4'],
        ['image_uploads', new File(['p'], 'clip.jpg')],
      ]),
      ID,
      [],
    )
    expect(values).toMatchObject({ photos: [], video: 'clip.mp4', poster: 'clip.jpg' })
    expect(uploads.map((upload) => upload.name)).toEqual(['clip.jpg'])
    let both = readComposeForm(
      form([
        ['photo', 'a.jpg'],
        ['video_upload', new File(['v'], 'clip.mp4')],
      ]),
      ID,
      [],
    )
    expect(both.values.video).toBeUndefined()
    expect(both.issues[0]?.message).toMatch(/photos or a video, not both/)
    let removed = readComposeForm(
      form([
        ['video', 'clip.mp4'],
        ['poster', 'clip.jpg'],
        ['remove', 'clip.mp4'],
      ]),
      ID,
      [],
    )
    expect(removed.values).toMatchObject({ video: undefined, poster: undefined })
  })

  it('edits a published post, keeping what the composer doesn’t show', () => {
    let published = {
      id: ID,
      type: 'photos',
      date: DATE,
      city: 'Hanoi',
      caption: 'Hi',
      photos: [
        { file: 'a.jpg', alt: 'A lake' },
        { file: 'b.jpg', alt: 'A hill' },
      ],
    } satisfies PostRecord
    let values = composeValues(published)
    expect(values).toEqual({
      id: ID,
      caption: 'Hi',
      photos: ['a.jpg', 'b.jpg'],
      video: undefined,
      poster: undefined,
    })
    let edited = { ...values, caption: 'Edited', photos: ['b.jpg', 'c.jpg'] }
    expect(composePost(edited, '2026-10-25T00:00:00Z', published)).toEqual({
      id: ID,
      type: 'photos',
      date: DATE,
      city: 'Hanoi',
      caption: 'Edited',
      photos: [
        { file: 'b.jpg', alt: 'A hill' },
        { file: 'c.jpg', alt: 'c.jpg' },
      ],
    })

    // A video keeps its size until it's replaced.
    let video = {
      id: ID,
      type: 'video',
      date: DATE,
      video: { file: 'clip.mp4', width: 640, height: 360 },
    } satisfies PostRecord
    let kept = composePost({ ...composeValues(video), video: 'clip.mp4' }, DATE, video)
    expect(kept.type === 'video' && kept.video).toEqual(video.video)
    let replaced = composePost({ ...composeValues(video), video: 'new.mp4' }, DATE, video)
    expect(replaced.type === 'video' && replaced.video).toEqual({ file: 'new.mp4' })
  })
})
