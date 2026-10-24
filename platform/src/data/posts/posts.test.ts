// Posts: their records, captions, and how pages present them.
import { describe, expect, it } from 'bun:test'

import { captionText, getFirstLink, renderCaption } from './caption.ts'
import { formatPostDate } from './format.ts'
import { isUploadableFileName, parsePostRecord, type PostRecord } from './post.ts'
import { getPostMeta, toPost } from './presentation.ts'
import { fromPostRow, toPostRow } from './rows.ts'

const ID = 'fc7p7vjhx6'
const DATE = '2026-10-16T13:12:00Z'
const text = { id: ID, type: 'text', date: DATE, caption: 'Hi' } satisfies PostRecord

describe('parsePostRecord', () => {
  let issues = (post: unknown) => {
    let result = parsePostRecord(post)
    return result._tag === 'Failure' ? result.failure : []
  }

  it('names the field that’s wrong, as a path', () => {
    expect(issues({ ...text, type: 'video', video: { file: 'a.mp4', width: 'wide' } })).toEqual([
      { field: 'video.width', message: 'Expected a size in pixels' },
    ])
    expect(issues({ ...text, id: 'my-first-post' })[0]).toMatchObject({
      field: 'id',
      message: expect.stringMatching(/Expected 10 lowercase letters and digits/),
    })
    expect(issues({ ...text, id: ID.toUpperCase() })[0]?.field).toBe('id')
    for (let date of ['2026-10-16', '2026-10-16T18:42:00+05:30']) {
      expect(issues({ ...text, date })[0]).toMatchObject({
        field: 'date',
        message: expect.stringMatching(/Expected a UTC date/),
      })
    }
    expect(issues({ ...text, caption: ' ' })[0]?.message).toBe('Text posts need a caption')
    expect(issues({ ...text, type: 'poll' })[0]?.field).toBe('type')
    expect(issues({ ...text, type: 'photos', photos: [] })[0]?.message).toBe(
      'Expected at least one photo',
    )
    expect(issues({ ...text, type: 'video', video: { file: '../secret.mp4' } })[0]).toEqual({
      field: 'video.file',
      message: 'Expected the name of one of the post’s files, like "photo.jpg"',
    })
  })

  it('accepts each type of post, and stores and reads one back the same', () => {
    let posts = [
      text,
      { ...text, type: 'photos', caption: undefined, photos: [{ file: 'a.jpg', alt: 'A' }] },
      {
        ...text,
        type: 'video',
        city: 'Pune',
        video: { file: 'a.mp4', poster: 'a.jpg', width: 64, height: 36 },
      },
    ]
    for (let post of posts) {
      let result = parsePostRecord(JSON.parse(JSON.stringify(post)))
      if (result._tag === 'Failure') throw new Error(JSON.stringify(result.failure))
      expect(fromPostRow(toPostRow(result.success))).toEqual(result.success)
    }
  })

  it('throws, naming the post and field, for a stored post that’s wrong', () => {
    let row = { ...toPostRow(text), date: 'yesterday' }
    expect(() => fromPostRow(row)).toThrow(`post "${ID}", date: Expected a UTC date`)
  })
})

describe('isUploadableFileName', () => {
  it('allows photos and videos only', () => {
    for (let name of ['a.jpg', 'B.JPEG', 'c.png', 'd.webp', 'e.mp4', 'f.mov'])
      expect([name, isUploadableFileName(name)]).toEqual([name, true])
    for (let name of ['a.svg', 'b.html', 'c.txt', 'noextension', '.hidden.jpg', 'a/b.jpg']) {
      expect([name, isUploadableFileName(name)]).toEqual([name, false])
    }
  })
})

describe('captions', () => {
  let link = (url: string, text: string) =>
    `<a target="_blank" rel="noopener" href="${url}">${text}</a>`

  it('keeps line breaks and paragraphs, with bold and italic as the only formatting', () => {
    expect(renderCaption('**Hi** *there*\nnext line\n\n\n# Not a heading\n- or a list')).toBe(
      '<p><strong>Hi</strong> <em>there</em><br>next line</p>\n' +
        '<p># Not a heading<br>- or a list</p>',
    )
    expect(renderCaption('**a *b* c** 2 * 3 * 4 _x_ `y` [z](https://a.com)')).toBe(
      `<p><strong>a <em>b</em> c</strong> 2 * 3 * 4 _x_ \`y\` [z](${link('https://a.com', 'a.com')})</p>`,
    )
  })

  it('turns URLs into shortened links that open in a new tab', () => {
    expect(renderCaption('See https://www.remix.run/docs. And (https://x.com/a)!')).toBe(
      `<p>See ${link('https://www.remix.run/docs', 'remix.run/docs')}. ` +
        `And (${link('https://x.com/a', 'x.com/a')})!</p>`,
    )
    expect(renderCaption('**https://a.com/x_y*z** then more')).toBe(
      `<p><strong>${link('https://a.com/x_y*z', 'a.com/x_y*z')}</strong> then more</p>`,
    )
    expect(renderCaption(`https://example.com/${'a'.repeat(50)}`)).toContain(
      `>example.com/${'a'.repeat(27)}…</a>`,
    )
  })

  it('leaves URLs that don’t parse as plain text', () => {
    let text = 'Broken https://[bad-host] then https://remix.run'
    expect(renderCaption(text)).toBe(
      `<p>Broken https://[bad-host] then ${link('https://remix.run', 'remix.run')}</p>`,
    )
    expect(getFirstLink(text)).toBe('https://remix.run')
    expect(getFirstLink('Only https://[bad-host]')).toBeUndefined()
  })

  it('escapes HTML', () => {
    expect(renderCaption('<script>x</script> <0> & "')).toBe(
      '<p>&lt;script&gt;x&lt;/script&gt; &lt;0&gt; &amp; "</p>',
    )
    expect(renderCaption('https://a.com/?a=1&b=2')).toContain('href="https://a.com/?a=1&amp;b=2"')
  })

  it('strips formatting for plain text', () => {
    expect(captionText('**Title**\n\nSome *text*\nnext')).toBe('Title\nSome text\nnext')
  })
})

describe('presentation', () => {
  it('gives photos URLs, and the size and resized copies of those it knows', () => {
    let photos = [
      { file: 'a b.jpg', alt: 'A' },
      { file: 'c.jpg', alt: 'C' },
    ] as const
    let post = toPost({ id: ID, type: 'photos', date: DATE, photos }, (file) =>
      file === 'c.jpg' ? { width: 500, height: 400, version: 'v1' } : undefined,
    )
    expect(post.type === 'photos' && post.photos).toEqual([
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

  it('describes a post by its caption’s first line, shortened, and the rest of it', () => {
    let caption = `${'A long first line. '.repeat(5)}\n\nMore`
    let meta = getPostMeta(toPost({ id: ID, type: 'text', date: DATE, caption }))
    expect(meta.title?.length).toBe(60)
    expect(meta.title?.endsWith('…')).toBe(true)
    expect(meta.description).toMatch(/More$/)
    expect(meta.published).toBe(DATE)
  })

  it('shows dates in UTC', () => {
    expect(formatPostDate('2026-09-16T13:12:00Z')).toBe('16 Sep 2026, 1:12 PM UTC')
    expect(formatPostDate('2026-10-16T00:05:00Z')).toBe('16 Oct 2026, 12:05 AM UTC')
  })
})
