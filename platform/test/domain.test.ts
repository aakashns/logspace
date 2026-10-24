// The pure modules in src/domain.
import { describe, expect, it } from 'bun:test'

import { getForwardedOrigin } from '../src/http/forwarded.ts'
import { parseLinkMetadata } from '../src/domain/link-metadata.ts'
import { captionText, getFirstLink, renderCaption } from '../src/domain/caption.ts'
import { fromPostRow, toPostRow } from '../src/domain/post-rows.ts'
import { isUploadableFileName, parsePostRecord, type PostRecord } from '../src/domain/post.ts'
import { getPostMeta, toPost } from '../src/domain/presentation.ts'
import { composePost, composeValues, readComposeForm } from '../src/domain/compose.ts'
import { formatPostDate } from '../src/domain/format.ts'

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

describe('parseLinkMetadata', () => {
  it('reads Open Graph tags', () => {
    let html = `<html><head>
      <title>Fallback</title>
      <meta property="og:title" content="Tom &amp; Jerry&#39;s">
      <meta content='A description' property='og:description'>
      <meta property="og:image" content="/share.png">
      </head><body><meta property="og:title" content="Not this"></body></html>`
    expect(parseLinkMetadata(html, 'https://example.com/page')).toEqual({
      title: "Tom & Jerry's",
      description: 'A description',
      image: 'https://example.com/share.png',
    })
  })

  it('falls back to <title>, the meta description, and Twitter card tags', () => {
    let html = `<head><title>Page title</title><meta name="description" content="About it">
      <meta name="twitter:card" content="summary">
      <meta name="twitter:image" content="http://cdn.example.com/a.jpg"></head>`
    expect(parseLinkMetadata(html, 'https://example.com')).toEqual({
      title: 'Page title',
      description: 'About it',
      image: 'https://cdn.example.com/a.jpg',
      smallImage: true,
    })
  })

  it('ignores images that are not http(s)', () => {
    let html = `<head><meta property="og:image" content="javascript:alert(1)"></head>`
    expect(parseLinkMetadata(html, 'https://example.com').image).toBeUndefined()
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

describe('getForwardedOrigin', () => {
  // The origin a request through the proxy is seen at.
  let origin = (headers: Record<string, string>) => {
    let lower = Object.fromEntries(
      Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
    )
    let { protocol = 'http', host = '127.0.0.1:44100' } = getForwardedOrigin(lower)
    return new URL(`${protocol}://${host}`).origin
  }

  it('uses X-Forwarded-Proto and X-Forwarded-Host, the first of each', () => {
    expect(origin({ 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'example.com' })).toBe(
      'https://example.com',
    )
    expect(
      origin({ 'X-Forwarded-Proto': 'https, http', 'X-Forwarded-Host': 'example.com, proxy' }),
    ).toBe('https://example.com')
  })

  it('uses the standard Forwarded header when the proxy doesn’t set X-Forwarded-*', () => {
    expect(origin({ Forwarded: 'for=192.0.2.1;proto=https;host=example.com' })).toBe(
      'https://example.com',
    )
    // Quoted values, with delimiters and escapes in them, and the first element that has each.
    expect(
      origin({
        Forwarded: 'for="[2001:db8::1]:4711";Proto="HTTPS";host="example.com:8443", host=b',
      }),
    ).toBe('https://example.com:8443')
    expect(origin({ Forwarded: 'for="a;b,c";host="ex\\ample.com"' })).toBe('http://example.com')
    expect(origin({ Forwarded: 'host=example.com', 'X-Forwarded-Proto': 'https' })).toBe(
      'https://example.com',
    )
  })

  it('lets X-Forwarded-*, which Caddy overwrites, win over a Forwarded header a browser sent', () => {
    expect(
      origin({
        Forwarded: 'proto=http;host=evil.example',
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'example.com',
      }),
    ).toBe('https://example.com')
  })

  it('keeps the ports that are given, and drops the default ones', () => {
    expect(origin({ 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'example.com:443' })).toBe(
      'https://example.com',
    )
    expect(origin({ 'X-Forwarded-Proto': 'https' })).toBe('https://127.0.0.1:44100')
  })

  it('ignores values it can’t use', () => {
    expect(origin({ Forwarded: 'proto=ftp;host=', 'X-Forwarded-Proto': 'gopher' })).toBe(
      'http://127.0.0.1:44100',
    )
    expect(origin({ 'X-Forwarded-Host': 'bad host[' })).toBe('http://127.0.0.1:44100')
    expect(origin({ 'X-Forwarded-Host': 'evil.example/path' })).toBe('http://127.0.0.1:44100')
  })
})
