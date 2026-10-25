// The composer, where posts are written, edited, and deleted.
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { Effect } from 'effect'

import { capture, defined, makeTestApp } from '../../../../test/app.ts'
import { PostCommands } from '../../../data/posts/commands.ts'
import { makePostFiles } from '../../../data/posts/files.ts'
import type { Post } from '../../../data/posts/presentation.ts'
import { PostQueries } from '../../../data/posts/queries.ts'
import { MediaStorage, mediaKeys } from '../../../lib/media-storage.ts'

const app = makeTestApp()
const posts = () => app.run(Effect.flatMap(PostQueries, (queries) => queries.all))
const findPost = async (id: string) => (await posts()).find((post) => post.id === id)
const firstPost = async () => defined((await posts())[0], 'a post')
const samplePost = async <T extends Post['type']>(type: T) =>
  defined(
    (await posts()).find((post): post is Extract<Post, { type: T }> => post.type === type),
    `a ${type} post`,
  )
const hasPostFile = (id: string, name: string) =>
  app.run(Effect.flatMap(MediaStorage, (storage) => storage.has(mediaKeys.postFile(id, name))))
const savePostFile = (id: string, name: string, file: Blob) =>
  app.run(Effect.flatMap(makePostFiles(), (files) => files.save(id, name, file)))

// Saving a post removes the files it doesn't name, so each test starts with all of them.
beforeEach(async () => {
  await app.seedDatabase()
  await app.seedMedia()
})
afterAll(app.dispose)

describe('the composer', () => {
  let photo = (name: string) =>
    new File([Bun.file('test/content/posts/drdp3ei6fd/hike-1.jpg')], name, {
      type: 'image/jpeg',
    })
  // The composer's form, as Datastar (or the browser) posts it.
  let composerPost = (path: string, fields: [string, string | File][]) => {
    let body = new FormData()
    for (let [name, value] of fields) body.append(name, value)
    return app.adminFetch(path, { method: 'POST', body })
  }
  let save = (fields: [string, string | File][]) => composerPost('/admin/posts', fields)
  let media = (fields: [string, string | File][]) => composerPost('/admin/posts/media', fields)
  let noFile = () => new File([], '', { type: 'application/octet-stream' })

  it('needs an admin login', async () => {
    let post = await firstPost()
    for (let path of ['/admin/posts/new', `/admin/posts/${post.id}/edit`]) {
      let response = await app.fetch(path)
      expect([path, response.status, response.headers.get('Location')]).toEqual([
        path,
        302,
        '/admin/login',
      ])
    }
    let body = new FormData()
    body.append('post_id', post.id)
    body.append('caption', 'Not logged in')
    body.append('image_uploads', photo('a.jpg'))
    for (let path of ['/admin/posts', '/admin/posts/media']) {
      expect((await app.fetch(path, { method: 'POST', body })).status).toBe(302)
    }
    expect((await findPost(post.id))?.caption).not.toBe('Not logged in')
    expect(await hasPostFile(post.id, 'a.jpg')).toBe(false)
  })

  it('/admin/posts links to the composer, for a new post and to edit each one', async () => {
    let html = await (await app.adminFetch('/admin/posts')).text()
    expect(html).toContain('href="/admin/posts/new"')
    for (let post of await posts()) expect(html).toContain(`href="/admin/posts/${post.id}/edit"`)
  })

  it('starts a new post, as a plain form run by Datastar', async () => {
    let html = await (await app.adminFetch('/admin/posts/new')).text()
    expect(html).toMatch(/<h1 class="page-title">New Post<\/h1>/)
    expect(html).toMatch(
      /<form id="composer" method="post" action="\/admin\/posts" enctype="multipart\/form-data"/,
    )
    expect(html).toMatch(/<input type="hidden" name="post_id" value="[0-9a-z]{10}"/)
    expect(html).toMatch(/<input type="file" name="image_uploads" accept="image\/\*" multiple/)
    // Its × discards it; there's nothing to delete yet.
    expect(html).toMatch(
      /<button [^>]*formaction="\/admin\/posts\/discard" aria-label="Discard post"/,
    )
    expect(html).not.toMatch(/delete-post/)
    let datastar = capture(html, /<script type="module" src="(\/assets\/datastar\.[0-9a-f]+\.js)"/)
    expect((await app.fetch(datastar)).status).toBe(200)
  })

  it('edits a published post, starting with its caption and media', async () => {
    let post = await samplePost('photos')
    let html = await (await app.adminFetch(`/admin/posts/${post.id}/edit`)).text()
    expect(html).toMatch(/<h1 class="page-title">Edit Post<\/h1>/)
    expect(html).toMatch(/<form id="composer" method="post" action="\/admin\/posts"/)
    expect(html).toContain(`<input type="hidden" name="post_id" value="${post.id}">`)
    expect(html).toContain(`>\n${post.caption}</textarea>`)
    for (let file of ['hike-1.jpg', 'hike-2.jpg', 'hike-3.jpg']) {
      expect(html).toContain(`<input type="hidden" name="photo" value="${file}">`)
    }
    expect(html).toMatch(
      /<button [^>]*formaction="\/admin\/posts\/discard" aria-label="Revert changes"/,
    )
    expect(html).toMatch(/>\s*Save\s*<\/button>/)
    expect((await app.adminFetch('/admin/posts/nosuchpost/edit')).status).toBe(404)
  })

  it('uploads photos as they’re chosen, renaming ones whose names are taken', async () => {
    let id = 'composer02'
    await media([
      ['post_id', id],
      ['image_uploads', photo('image.jpg')],
    ])
    let response = await media([
      ['post_id', id],
      ['photo', 'image.jpg'],
      ['image_uploads', photo('image.jpg')],
      ['image_uploads', photo('My Photo.jpg')],
    ])
    expect(response.headers.get('Content-Type')).toMatch(/^text\/event-stream/)
    let events = await response.text()
    expect(events).toContain('data: selector #composer-media\ndata: mode replace\n')
    expect(events).toContain('data: selector #composer-tools\n')
    for (let file of ['image.jpg', 'image-2.jpg', 'My-Photo.jpg']) {
      expect(events).toContain(`<input type="hidden" name="photo" value="${file}">`)
    }
    expect(await hasPostFile(id, 'image-2.jpg')).toBe(true)
    expect(await hasPostFile(id, 'My-Photo.jpg')).toBe(true)
    // The composer shows them before the post is saved, and nobody else sees them.
    expect(events).toContain(`/admin/posts/${id}/files/image-2.jpg`)
    let file = await app.adminFetch(`/admin/posts/${id}/files/image-2.jpg`)
    expect(file.status).toBe(200)
    expect(file.headers.get('Content-Type')).toBe('image/jpeg')
    expect((await app.fetch(`/admin/posts/${id}/files/image-2.jpg`)).status).toBe(302)
    expect((await app.fetch(`/posts/${id}/image-2.jpg`)).status).toBe(404)
  })

  it('takes media out of the form, and a video’s poster with it', async () => {
    let photos = await (
      await media([
        ['post_id', 'composer03'],
        ['photo', 'a.jpg'],
        ['photo', 'b.jpg'],
        ['remove', 'a.jpg'],
      ])
    ).text()
    expect(photos).not.toContain('value="a.jpg"')
    expect(photos).toContain('<input type="hidden" name="photo" value="b.jpg">')

    let video = await (
      await media([
        ['post_id', 'composer03'],
        ['video', 'clip.mp4'],
        ['poster', 'clip.jpg'],
        ['remove', 'clip.mp4'],
      ])
    ).text()
    expect(video).not.toMatch(/name="(video|poster)"/)
  })

  it('takes photos or a video, not both', async () => {
    let events = await (
      await media([
        ['post_id', 'composer04'],
        ['photo', 'a.jpg'],
        ['video_upload', new File(['v'], 'clip.mp4', { type: 'video/mp4' })],
      ])
    ).text()
    expect(events).toContain('data: selector #composer-issues')
    expect(events).toMatch(/A post can have photos or a video, not both/)
    expect(events).not.toMatch(/name="video"/)
    expect(await hasPostFile('composer04', 'clip.mp4')).toBe(false)
  })

  it('previews the post as it’s written, without saving it', async () => {
    let post = await samplePost('text')
    let events = await (
      await composerPost('/admin/posts/preview', [
        ['post_id', post.id],
        ['caption', 'Hello **world**'],
      ])
    ).text()
    expect(events).toContain('data: selector #composer-preview\ndata: mode inner\n')
    expect(events).toContain('<strong>world</strong>')
    // An edit's preview keeps the post's date.
    expect(events).toContain(`datetime="${post.date}"`)
    expect((await findPost(post.id))?.caption).toBe(post.caption)
  })

  it('publishes a photos post dated now, in UTC, with file names as alt text', async () => {
    let id = 'composer06'
    await media([
      ['post_id', id],
      ['image_uploads', photo('peak.jpg')],
      ['image_uploads', photo('extra.jpg')],
    ])
    let before = Date.now()
    let response = await save([
      ['post_id', id],
      ['caption', 'Up top'],
      ['photo', 'peak.jpg'],
    ])
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe(`/posts/${id}`)
    let post = defined(await findPost(id), 'the post')
    expect(post.type).toBe('photos')
    expect(post.caption).toBe('Up top')
    expect(post.city).toBeUndefined()
    expect(post.type === 'photos' && post.photos.map((photo) => photo.alt)).toEqual(['peak.jpg'])
    expect(post.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    expect(Math.abs(Date.parse(post.date) - before)).toBeLessThan(5_000)
    expect((await app.fetch(`/posts/${id}/peak.jpg`)).status).toBe(200)
    // A file taken out before it was posted goes once it is.
    expect(await hasPostFile(id, 'extra.jpg')).toBe(false)
  })

  it('publishes a video with its poster', async () => {
    let id = 'composer07'
    await media([
      ['post_id', id],
      ['video_upload', new File(['v'], 'clip.mp4', { type: 'video/mp4' })],
    ])
    let events = await (
      await media([
        ['post_id', id],
        ['video', 'clip.mp4'],
        ['image_uploads', photo('clip.jpg')],
      ])
    ).text()
    expect(events).toContain('<input type="hidden" name="poster" value="clip.jpg">')
    // With a video, the photo button adds its poster.
    let response = await save([
      ['post_id', id],
      ['video', 'clip.mp4'],
      ['poster', 'clip.jpg'],
    ])
    expect(response.status).toBe(303)
    let post = await findPost(id)
    expect(post?.type === 'video' && post.video.src).toBe(`/posts/${id}/clip.mp4`)
    expect(post?.type === 'video' && post.video.poster).toMatch(`/posts/${id}/clip.jpg`)
  })

  it('saves an edit, keeping the post’s date, city, and alt text', async () => {
    let post = await samplePost('photos')
    let response = await save([
      ['post_id', post.id],
      ['caption', '  **Bold**\r\n\r\nand *italic*  \r\n'],
      ['photo', 'hike-3.jpg'],
      ['photo', 'hike-1.jpg'],
    ])
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe(`/posts/${post.id}`)
    let saved = await findPost(post.id)
    expect(saved?.date).toBe(post.date)
    expect(saved?.city).toBe(post.city)
    expect(saved?.caption).toBe('**Bold**\n\nand *italic*')
    let photos = saved?.type === 'photos' ? saved.photos : []
    expect(photos.map(({ src, alt }) => ({ src: src.split('?')[0], alt }))).toEqual([
      {
        src: `/posts/${post.id}/hike-3.jpg`,
        alt: 'Snowy mountain peak above a forest',
      },
      {
        src: `/posts/${post.id}/hike-1.jpg`,
        alt: 'River winding through a valley between cliffs',
      },
    ])
    expect(await (await app.fetch(`/posts/${post.id}`)).text()).toContain(
      '<p><strong>Bold</strong></p>\n<p>and <em>italic</em></p>',
    )
    // The photo taken out is deleted with the save.
    expect(await hasPostFile(post.id, 'hike-2.jpg')).toBe(false)
    expect((await app.fetch(`/posts/${post.id}/hike-2.jpg`)).status).toBe(404)
  })

  it('changes nothing published until an edit is saved', async () => {
    let post = await samplePost('photos')
    let events = await (
      await media([
        ['post_id', post.id],
        ['photo', 'hike-1.jpg'],
        ['photo', 'hike-2.jpg'],
        ['photo', 'hike-3.jpg'],
        ['remove', 'hike-1.jpg'],
        ['image_uploads', new File(['new'], 'hike-1.jpg', { type: 'image/jpeg' })],
      ])
    ).text()
    // A chosen file takes a name of its own, so the published one stays as it is.
    expect(events).not.toContain('value="hike-1.jpg"')
    expect(events).toContain('<input type="hidden" name="photo" value="hike-1-2.jpg">')
    expect(await findPost(post.id)).toEqual(post)
    expect((await app.fetch(`/posts/${post.id}/hike-1.jpg`)).status).toBe(200)
    // Nor is the new one public yet.
    expect((await app.fetch(`/posts/${post.id}/hike-1-2.jpg`)).status).toBe(404)
  })

  it('an edit can change what kind of post it is', async () => {
    let post = await samplePost('photos')
    expect(
      (
        await save([
          ['post_id', post.id],
          ['caption', 'Just words now'],
        ])
      ).status,
    ).toBe(303)
    let saved = await findPost(post.id)
    expect(saved?.type).toBe('text')
    expect(saved?.date).toBe(post.date)
    expect(await hasPostFile(post.id, 'hike-1.jpg')).toBe(false)
  })

  it('an edit can replace a video, without JavaScript', async () => {
    let video = await samplePost('video')
    let response = await save([
      ['post_id', video.id],
      ['caption', ''],
      ['video', 'flower.mp4'],
      ['poster', 'poster.jpg'],
      ['video_upload', new File(['new video'], 'garden.mp4')],
      ['image_uploads', noFile()],
    ])
    expect(response.status).toBe(303)
    let saved = await findPost(video.id)
    expect(saved?.type === 'video' && saved.video.src).toBe(`/posts/${video.id}/garden.mp4`)
    expect(saved?.type === 'video' && saved.video.poster).toMatch(/poster\.jpg/)
    expect(await hasPostFile(video.id, 'flower.mp4')).toBe(false)
  })

  it('closing the composer throws away what it uploaded, and goes back to /admin/posts', async () => {
    let id = 'discard001'
    await media([
      ['post_id', id],
      ['image_uploads', photo('a.jpg')],
    ])
    let closed = await composerPost('/admin/posts/discard', [['post_id', id]])
    expect(closed.status).toBe(303)
    expect(closed.headers.get('Location')).toBe('/admin/posts')
    expect(await hasPostFile(id, 'a.jpg')).toBe(false)

    // An edit's uploads go, and the post's own files stay.
    let post = await samplePost('photos')
    await media([
      ['post_id', post.id],
      ['image_uploads', photo('new.jpg')],
    ])
    await composerPost('/admin/posts/discard', [
      ['post_id', post.id],
      ['caption', 'Unsaved'],
    ])
    expect(await hasPostFile(post.id, 'new.jpg')).toBe(false)
    expect(await hasPostFile(post.id, 'hike-1.jpg')).toBe(true)
    expect(await findPost(post.id)).toEqual(post)
  })

  it('won’t save an empty post', async () => {
    let page = await save([
      ['post_id', 'composer08'],
      ['caption', '  \n'],
    ])
    expect(page.status).toBe(400)
    expect(await page.text()).toMatch(/Write something, or add photos or a video/)
    expect(await findPost('composer08')).toBeUndefined()

    let post = await samplePost('text')
    let edit = await save([
      ['post_id', post.id],
      ['caption', ''],
    ])
    expect(edit.status).toBe(400)
    expect(await edit.text()).toMatch(/<h1 class="page-title">Edit Post<\/h1>/)
    expect(await findPost(post.id)).toEqual(post)
  })

  it('creates a new post once, and the same form posted again saves it again', async () => {
    let page = await (await app.adminFetch('/admin/posts/new')).text()
    let id = capture(page, /<input [^>]*name="post_id"[^>]*value="([0-9a-z]{10})"/)
    let submit = () =>
      save([
        ['post_id', id],
        ['caption', 'A brand new post'],
      ])
    let response = await submit()
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe(`/posts/${id}`)
    let published = await findPost(id)
    let again = await submit()
    expect(again.status).toBe(303)
    expect(await findPost(id)).toEqual(published)
    expect((await posts()).filter((post) => post.caption === 'A brand new post')).toHaveLength(1)
  })

  it('publishes the files chosen without Datastar', async () => {
    let id = 'uploadnew1'
    let response = await save([
      ['post_id', id],
      ['caption', ''],
      ['image_uploads', new File(['one'], 'My Photo.jpg', { type: 'image/jpeg' })],
      ['image_uploads', new File(['two'], 'two.png', { type: 'image/png' })],
      ['image_uploads', new File(['three'], 'three.webp', { type: 'text/html' })],
      ['video_upload', noFile()],
    ])
    expect(response.status).toBe(303)
    let saved = await findPost(id)
    expect(saved?.type === 'photos' && saved.photos).toEqual([
      { src: `/posts/${id}/My-Photo.jpg`, alt: 'My-Photo.jpg' },
      { src: `/posts/${id}/two.png`, alt: 'two.png' },
      { src: `/posts/${id}/three.webp`, alt: 'three.webp' },
    ])

    // Served with the type its name gives, not the one the browser claimed.
    let file = await app.fetch(`/posts/${id}/three.webp`)
    expect(file.status).toBe(200)
    expect(file.headers.get('Content-Type')).toBe('image/webp')
    expect(await file.text()).toBe('three')
  })

  it('rejects files that aren’t photos or videos, and keeps the ones that are', async () => {
    let id = 'uploadbad1'
    let response = await save([
      ['post_id', id],
      ['video_upload', new File(['v'], 'clip.mp4')],
      ['image_uploads', new File(['<svg/>'], 'poster.svg')],
    ])
    let html = await response.text()
    expect(response.status).toBe(400)
    expect(html).toMatch(/“poster\.svg” can’t be added here/)
    expect(await findPost(id)).toBeUndefined()
    expect(await hasPostFile(id, 'poster.svg')).toBe(false)
    // The video was saved, so the composer comes back with it, and posting again publishes.
    expect(await hasPostFile(id, 'clip.mp4')).toBe(true)
    expect(html).toContain('<input type="hidden" name="video" value="clip.mp4">')
  })

  it('refuses a post naming a file it doesn’t have', async () => {
    let post = await samplePost('video')
    let response = await save([
      ['post_id', post.id],
      ['video', 'missing.mp4'],
    ])
    expect(response.status).toBe(400)
    expect(await response.text()).toMatch(/missing\.mp4 isn’t one of this post’s files/)
    expect(await findPost(post.id)).toEqual(post)
  })

  it('deletes a post from its edit page', async () => {
    let id = 'deleteme00'
    await app.run(
      Effect.flatMap(PostCommands, (commands) =>
        commands.save({
          post: {
            id,
            type: 'text',
            date: '2026-10-01T09:00:00Z',
            caption: 'Bye',
          },
          uploads: [],
          issues: [],
        }),
      ),
    )
    await savePostFile(id, 'a.jpg', new File(['a'], 'a.jpg'))
    let edit = await (await app.adminFetch(`/admin/posts/${id}/edit`)).text()
    expect(edit).toMatch(/<dialog id="delete-post"/)
    expect(edit).toMatch(/<form method="post" action="\/admin\/posts\/deleteme00\/delete"/)
    expect(edit).toMatch(/command="show-modal"/)

    let path = `/admin/posts/${id}/delete`
    expect((await app.fetch(path, { method: 'POST' })).status).toBe(302)
    expect(await findPost(id)).toBeDefined()

    let response = await app.adminFetch(path, { method: 'POST' })
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe('/admin/posts')
    expect((await app.fetch(`/posts/${id}`)).status).toBe(404)
    expect(await hasPostFile(id, 'a.jpg')).toBe(false)
    expect((await app.adminFetch(path, { method: 'POST' })).status).toBe(404)
  })

  it('answers a form with too many files with a page saying so', async () => {
    let post = await samplePost('text')
    let files = Array.from({ length: 101 }, (): [string, File] => ['image_uploads', noFile()])
    let response = await save([['post_id', post.id], ['caption', 'Too many'], ...files])
    expect(response.status).toBe(413)
    expect(await response.text()).toMatch(/Upload too large/)
    expect((await findPost(post.id))?.caption).not.toBe('Too many')
  })

  it('answers a form over the total size before reading it, and says so as files are added', async () => {
    let tooBig = (path: string) =>
      app.adminFetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data; boundary=x',
          'Content-Length': String(121 * 1024 * 1024),
        },
        body: '--x--',
      })
    expect((await tooBig('/admin/posts')).status).toBe(413)
    let response = await tooBig('/admin/posts/media')
    expect(response.status).toBe(200)
    expect(await response.text()).toMatch(/too big to upload/)
  })

  it('is linked from the navbar of every page while logged in', async () => {
    let login = await app.logIn()
    let hint = login.headers.getSetCookie().find((cookie) => cookie.startsWith('admin='))
    expect(hint).toMatch(/Path=\/(;|$)/)
    let cookie = defined(hint?.split(';')[0], 'the admin cookie')
    let home = await (await app.fetch('/', { headers: { Cookie: cookie } })).text()
    expect(home).toMatch(
      /<header[^]*href="\/admin\/posts\/new" aria-label="New Post"[^]*<\/header>/,
    )
    expect(await (await app.fetch('/')).text()).not.toContain('aria-label="New Post"')
    // Logging out clears it.
    let session = defined(app.sessionCookie(login), 'a session cookie')
    let logout = await app.fetch('/admin/logout', {
      method: 'POST',
      headers: { Cookie: `${session}; ${cookie}` },
    })
    expect(logout.headers.getSetCookie().join('\n')).toMatch(/^admin=;.*Max-Age=0/m)
  })
})
