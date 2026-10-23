// Regressions for what a security and correctness review of this app found.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { Effect } from 'effect'
import sharp from 'sharp'

import { PostCommands } from '../src/commands/posts.ts'
import { isUploadableFileName, mimeType } from '../src/domain/post.ts'
import { makeTestApp } from './app.ts'

const app = makeTestApp()
beforeAll(app.seedMedia)
beforeEach(app.seedDatabase)
afterAll(app.dispose)

const publish = (post: Record<string, unknown>) =>
  app.run(
    Effect.flatMap(PostCommands, (commands) =>
      commands.publish({ post: post as { id: string; type: string }, uploads: [], issues: [] }),
    ),
  )

describe('found in review', () => {
  it('renders an article with a stray % in an image or video name, and the feed with it', async () => {
    let id = 'percent001'
    let body = '![v](https://example.com/100%.mp4)\n\n![x](/posts/percent001/50%.jpg)'
    await publish({
      id,
      type: 'article',
      date: '2026-10-23T09:00:00Z',
      article: { title: 'T', summary: 'S', body },
    })
    expect((await app.fetch(`/posts/${id}`)).status).toBe(200)
    expect((await app.fetch('/rss.xml')).status).toBe(200)
  })

  it('publishes a new post submitted twice at once only once, refusing the other', async () => {
    let form = () => {
      let body = new FormData()
      for (let [name, value] of Object.entries({
        id: 'twice00001',
        type: 'photos',
        date: '2026-10-21T09:30',
        offset: '+05:30',
        photo_file: '',
        photo_alt: 'A',
      })) {
        body.append(name, value)
      }
      body.append('photo_upload', new File(['one'], 'one.jpg'))
      return body
    }
    let cookie = app.sessionCookie(await app.logIn())!
    let submit = () =>
      app.fetch('/admin/posts/new', { method: 'POST', headers: { Cookie: cookie }, body: form() })
    let statuses = (await Promise.all([submit(), submit()]))
      .map((response) => response.status)
      .sort()
    expect(statuses).toEqual([303, 400])
  })

  it('reads at most a few kilobytes of a login form, which anyone can send', async () => {
    let big = new URLSearchParams({ password: 'x'.repeat(64 * 1024) })
    let response = await app.fetch('/admin/login', { method: 'POST', body: big })
    expect(response.status).toBe(413)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    let declared = await app.fetch('/admin/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': String(50 * 1024 * 1024),
      },
      body: 'password=x',
    })
    expect(declared.status).toBe(413)
    let wrong = await app.logIn('wrong-password')
    expect(wrong.headers.get('Cache-Control')).toBe('no-store')
    expect(wrong.headers.get('X-Robots-Tag')).toBe('noindex')
  })

  it('declares UTF-8 on plain text responses', async () => {
    let fresh = makeTestApp()
    let response = await fresh.fetch('/rss.xml')
    expect(response.status).toBe(503)
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    expect(await response.text()).toBe('This site isn’t set up yet.')
    await fresh.dispose()
  })

  it('answers a resized copy of a photo sharp can’t decode with a 404, not a 500', async () => {
    let id = 'truncated1'
    let jpeg = await sharp({
      create: { width: 2000, height: 1500, channels: 3, background: '#468' },
    })
      .jpeg()
      .toBuffer()
    let cookie = app.sessionCookie(await app.logIn())!
    let body = new FormData()
    for (let [name, value] of Object.entries({
      id,
      type: 'photos',
      date: '2026-10-21T09:30',
      offset: '+05:30',
      photo_file: '',
      photo_alt: 'A',
    })) {
      body.append(name, value)
    }
    // Enough of the file to read its size, but not its pixels.
    body.append(
      'photo_upload',
      new File([jpeg.subarray(0, Math.floor(jpeg.length * 0.6))], 'cut.jpg'),
    )
    expect(
      (await app.fetch('/admin/posts/new', { method: 'POST', headers: { Cookie: cookie }, body }))
        .status,
    ).toBe(303)
    let html = await (await app.fetch(`/posts/${id}`)).text()
    let src = html.match(/srcset="([^" ]+)/)?.[1].replaceAll('&amp;', '&')
    expect(src).toMatch(/\/posts\/truncated1\/cut\.jpg\?w=/)
    expect((await app.fetch(src!)).status).toBe(404)
  })

  it('accepts the photo and video formats LogSpace 0.1 did, with its types', () => {
    for (let [name, type] of [
      ['a.jfif', 'image/pjpeg'],
      ['a.JXL', 'image/jxl'],
      ['a.dng', 'image/x-adobe-dng'],
      ['a.bmp', 'image/bmp'],
      ['a.ts', 'video/mp2t'],
      ['a.m2ts', 'video/mp2t'],
      ['a.mov', 'video/quicktime'],
    ]) {
      expect([name, mimeType(name), isUploadableFileName(name)]).toEqual([name, type, true])
    }
  })
})
