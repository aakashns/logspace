// Logging in and out, and the admin post pages.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { makePostFiles } from '../src/commands/post-files.ts'
import { PostCommands } from '../src/commands/posts.ts'
import type { Post } from '../src/domain/presentation.ts'
import { PostQueries } from '../src/queries/posts.ts'
import { MediaStorage, mediaKeys } from '../src/services/media-storage.ts'
import { capture, defined, makeTestApp } from './app.ts'

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

beforeAll(app.seedMedia)
beforeEach(app.seedDatabase)
afterAll(app.dispose)

describe('logging in', () => {
  it('sends visitors who are not logged in as admin from /admin to the login page', async () => {
    let response = await app.fetch('/admin')
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('/admin/login')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('shows a password form, kept out of search results', async () => {
    let response = await app.fetch('/admin/login')
    let html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toMatch(/<input [^>]*type="password"/)
    expect(html).toMatch(/<meta name="robots" content="noindex">/)
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex')
  })

  it('rejects a wrong password, without a session cookie', async () => {
    let response = await app.logIn('not-the-password')
    expect(response.status).toBe(401)
    expect(await response.text()).toMatch(/That password isn’t right/)
    expect(app.sessionCookie(response)).toBeUndefined()
  })

  it('shows every post once logged in, and logging out ends the session', async () => {
    let response = await app.logIn()
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('/admin')
    let setCookie = response.headers.getSetCookie().join('\n')
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/SameSite=Lax/i)
    expect(setCookie).toMatch(/Path=\/admin/i)

    let cookie = defined(app.sessionCookie(response), 'a session cookie')
    let page = await app.fetch('/admin', { headers: { Cookie: cookie } })
    let html = await page.text()
    expect(page.status).toBe(200)
    expect(html).toMatch(/<header[^]*aria-label="Log out"[^]*<\/header>/)
    for (let post of await posts()) expect(html).toContain(`href="/posts/${post.id}"`)
    // Logged in, the login page leads to /admin.
    expect(
      (await app.fetch('/admin/login', { headers: { Cookie: cookie } })).headers.get('Location'),
    ).toBe('/admin')

    let logout = await app.fetch('/admin/logout', { method: 'POST', headers: { Cookie: cookie } })
    expect(logout.status).toBe(302)
    let cleared = app.sessionCookie(logout)
    let after = await app.fetch('/admin', { headers: cleared ? { Cookie: cleared } : {} })
    expect(after.status).toBe(302)
  })

  it('rejects a tampered session cookie', async () => {
    let cookie = defined(app.sessionCookie(await app.logIn()), 'a session cookie')
    let tampered = cookie.slice(0, -2) + (cookie.endsWith('A') ? 'BB' : 'AA')
    expect((await app.fetch('/admin', { headers: { Cookie: tampered } })).status).toBe(302)
    // Or one made up to look logged in, signed with the wrong secret.
    let forged = `admin_session=${Buffer.from('{"id":"x","auth":"anything"}').toString('base64url')}.c2lnbmF0dXJl`
    expect((await app.fetch('/admin', { headers: { Cookie: forged } })).status).toBe(302)
  })

  it('rejects admin logins posted from other sites', async () => {
    for (let headers of [{ 'Sec-Fetch-Site': 'cross-site' }, { Origin: 'https://evil.example' }]) {
      let response = await app.logIn(undefined, headers)
      expect(response.status).toBe(403)
      expect(app.sessionCookie(response)).toBeUndefined()
    }
    // A browser's own form, or a request from no browser at all, is fine.
    expect((await app.logIn(undefined, { 'Sec-Fetch-Site': 'same-origin' })).status).toBe(302)
    expect((await app.logIn(undefined, { Origin: 'http://localhost' })).status).toBe(302)
  })

  it('is switched off until the password and secret are long enough', async () => {
    let off = makeTestApp({ adminPassword: (await import('effect')).Redacted.make('short') })
    let html = await (await off.fetch('/admin/login')).text()
    expect(html).toMatch(/Managing the site is switched off/)
    expect((await off.logIn('short')).status).toBe(401)
    await off.dispose()
  })
})

describe('admin post pages', () => {
  // A text post's form fields, as the browser sends them.
  let textPostForm = (fields: Record<string, string> = {}) =>
    new URLSearchParams({
      type: 'text',
      date: '2026-10-21T09:30',
      city: '',
      caption: 'Hello\r\nworld',
      ...fields,
    })

  it('need an admin login', async () => {
    let post = await firstPost()
    for (let path of ['/admin/posts/new', `/admin/posts/${post.id}/edit`]) {
      let response = await app.fetch(path)
      expect([path, response.status, response.headers.get('Location')]).toEqual([
        path,
        302,
        '/admin/login',
      ])
    }
    let edit = await app.fetch(`/admin/posts/${post.id}/edit`, {
      method: 'POST',
      body: textPostForm({ caption: 'Not logged in' }),
    })
    expect(edit.status).toBe(302)
    expect((await findPost(post.id))?.caption).not.toBe('Not logged in')
  })

  it('/admin links to the composer and to each post’s edit page', async () => {
    let html = await (await app.adminFetch('/admin')).text()
    expect(html).toContain('href="/admin/posts/new"')
    for (let post of await posts()) expect(html).toContain(`href="/admin/posts/${post.id}/edit"`)
  })

  it('the edit page starts with the post’s values', async () => {
    let post = await samplePost('photos')
    let html = await (await app.adminFetch(`/admin/posts/${post.id}/edit`)).text()
    // The type is shown but can't be changed, and only its fields are there.
    expect(html).not.toMatch(/<input [^>]*name="type"/)
    expect(html).toMatch(/Type: Photos/)
    // The date is in UTC, with no offset.
    expect(html).toMatch(
      new RegExp(`<input [^>]*name="date"[^>]*value="${post.date.slice(0, 16)}"`),
    )
    expect(html).not.toMatch(/name="offset"/)
    expect(html).not.toMatch(/<input [^>]*name="video_file"/)
    expect(html).toMatch(new RegExp(`<input [^>]*name="city"[^>]*value="${post.city}"`))
    expect(html).toMatch(
      new RegExp(`<textarea [^>]*name="caption"[^>]*>\\n${post.caption}</textarea>`),
    )
    expect(html).toMatch(/<input [^>]*name="photo_file"[^>]*value="hike-1\.jpg"/)
  })

  it('saving an edit updates the post and shows it', async () => {
    let post = await samplePost('text')
    let response = await app.adminFetch(`/admin/posts/${post.id}/edit`, {
      method: 'POST',
      body: textPostForm({ city: 'Hanoi' }),
    })
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe(`/posts/${post.id}`)
    let saved = await findPost(post.id)
    expect(saved?.caption).toBe('Hello\nworld')
    expect(saved?.city).toBe('Hanoi')
    expect(saved?.date).toBe('2026-10-21T09:30:00Z')
    expect(await (await app.fetch(`/posts/${post.id}`)).text()).toMatch(/Hanoi/)
  })

  it('saving photos keeps them in order and drops empty rows', async () => {
    let post = await samplePost('photos')
    let body = textPostForm({ type: 'photos', caption: '' })
    for (let [file, alt] of [
      ['hike-3.jpg', 'Peak'],
      ['', ''],
      ['hike-1.jpg', 'River'],
    ] as const) {
      body.append('photo_file', file)
      body.append('photo_alt', alt)
    }
    let response = await app.adminFetch(`/admin/posts/${post.id}/edit`, { method: 'POST', body })
    expect(response.status).toBe(303)
    let saved = await findPost(post.id)
    expect(saved?.caption).toBeUndefined()
    // Their sizes come from the files.
    let photos = saved?.type === 'photos' ? saved.photos : []
    expect(
      photos.map(({ src, alt, width, height }) => ({ src: src.split('?')[0], alt, width, height })),
    ).toEqual([
      { src: `/posts/${post.id}/hike-3.jpg`, alt: 'Peak', width: 24, height: 32 },
      { src: `/posts/${post.id}/hike-1.jpg`, alt: 'River', width: 32, height: 21 },
    ])
  })

  it('rejects an invalid edit with the reasons, and keeps what was typed', async () => {
    let post = await samplePost('video')
    let response = await app.adminFetch(`/admin/posts/${post.id}/edit`, {
      method: 'POST',
      body: textPostForm({
        type: 'video',
        caption: 'Typed caption',
        video_file: 'missing.mp4',
        video_width: 'wide',
      }),
    })
    let html = await response.text()
    expect(response.status).toBe(400)
    expect(html).toMatch(/role="alert"/)
    expect(html).toMatch(/Video width: Expected a size in pixels/)
    let widthInput = html.match(/<input [^>]*name="video_width"[^>]*>/)?.[0] ?? ''
    expect(widthInput).toMatch(/value="wide"/)
    expect(widthInput).toMatch(/aria-invalid="true"/)
    expect(html).toMatch(/Typed caption/)
    expect(await findPost(post.id)).toEqual(post)

    // Valid fields, but a file that isn't in the post's media.
    let missing = await app.adminFetch(`/admin/posts/${post.id}/edit`, {
      method: 'POST',
      body: textPostForm({ type: 'video', video_file: 'missing.mp4' }),
    })
    expect(missing.status).toBe(400)
    expect(await missing.text()).toMatch(/missing\.mp4 isn’t one of this post’s files/)
  })

  it('creates a new post, once', async () => {
    let page = await (await app.adminFetch('/admin/posts/new')).text()
    let id = capture(page, /<input [^>]*name="post_id"[^>]*value="([0-9a-z]{10})"/)
    let submit = () =>
      app.adminFetch('/admin/posts/new', {
        method: 'POST',
        body: textPostForm({ post_id: id, caption: 'A brand new post' }),
      })
    let response = await submit()
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe(`/posts/${id}`)
    expect(await (await app.fetch('/')).text()).toMatch(/A brand new post/)

    // Submitted again, it goes to the post.
    let again = await submit()
    expect(again.status).toBe(303)
    expect(again.headers.get('Location')).toBe(`/posts/${id}`)
  })

  it('an edit can’t change the post’s type', async () => {
    let post = await samplePost('text')
    let response = await app.adminFetch(`/admin/posts/${post.id}/edit`, {
      method: 'POST',
      body: textPostForm({ type: 'article', caption: 'Still text' }),
    })
    expect(response.status).toBe(303)
    let saved = await findPost(post.id)
    expect(saved?.type).toBe('text')
    expect(saved?.caption).toBe('Still text')
  })

  it('saves an article’s body in its own column', async () => {
    let post = await samplePost('article')
    let html = await (await app.adminFetch(`/admin/posts/${post.id}/edit`)).text()
    expect(html).toMatch(/<textarea [^>]*name="article_body"[^>]*>[^<]*\S/)
    let form = (body: string) =>
      textPostForm({
        type: 'article',
        article_title: post.article.title,
        article_summary: post.article.summary,
        article_body: body,
      })
    let response = await app.adminFetch(`/admin/posts/${post.id}/edit`, {
      method: 'POST',
      body: form('## Rewritten\r\n\r\nWith ![a desk](desk.jpg) in it.'),
    })
    expect(response.status).toBe(303)
    let saved = await findPost(post.id)
    expect(saved?.type === 'article' && saved.article.body).toBe(
      '## Rewritten\n\nWith ![a desk](desk.jpg) in it.',
    )
    // Stored in its own column, for search, rather than in the details JSON.
    let rows = await app.run(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) =>
          sql<{
            article_body: string
            details: string
          }>`select article_body, details from posts where id = ${post.id}`,
      ).pipe(Effect.orDie),
    )
    let row = defined(rows[0], 'the post’s row')
    expect(row.article_body).toBe('## Rewritten\n\nWith ![a desk](desk.jpg) in it.')
    expect(row.details).not.toMatch(/Rewritten/)
    let page = await (await app.fetch(`/posts/${post.id}`)).text()
    expect(page).toMatch(/<h2[^>]*>Rewritten<\/h2>/)
    expect(page).toContain(`<img src="/posts/${post.id}/desk.jpg"`)

    let empty = await app.adminFetch(`/admin/posts/${post.id}/edit`, {
      method: 'POST',
      body: form('   '),
    })
    expect(empty.status).toBe(400)
    expect(await empty.text()).toMatch(/Article body: Articles need a body/)
  })

  it('keeps Markdown exactly as typed, through a save and an unrelated edit', async () => {
    let post = await samplePost('article')
    // An indented code fence strips its indentation from the code, so the opening line's spaces
    // matter; so do a caption's, where four start a code block.
    let body = '  ```python\n  print("hello")\n  ```\n\nAfter the code.\n'
    let caption = '    indented code\n\nThen text.'
    // Browsers send textarea line breaks as \r\n.
    let crlf = (text: string) => text.replaceAll('\n', '\r\n')
    let save = (title: string, fields: { caption: string; body: string }) =>
      app.adminFetch(`/admin/posts/${post.id}/edit`, {
        method: 'POST',
        body: textPostForm({
          type: 'article',
          caption: crlf(fields.caption),
          article_title: title,
          article_summary: post.article.summary,
          article_body: crlf(fields.body),
        }),
      })
    let saved = async () => {
      let found = await findPost(post.id)
      if (found?.type !== 'article') throw new Error('Not an article')
      return found
    }

    expect((await save('First', { caption, body })).status).toBe(303)
    expect((await saved()).article.body).toBe(body)
    expect((await saved()).caption).toBe(caption)
    expect(await (await app.fetch(`/posts/${post.id}`)).text()).toMatch(
      /<code[^>]*>print\(&quot;hello&quot;\)/,
    )

    // Resubmit what the edit page shows, as a browser would read it, changing only the title.
    let html = await (await app.adminFetch(`/admin/posts/${post.id}/edit`)).text()
    let textarea = (name: string) =>
      unescapeHtml(
        capture(html, new RegExp(`<textarea [^>]*name="${name}"[^>]*>\\n([^<]*)</textarea>`)),
      )
    expect(
      (await save('Second', { caption: textarea('caption'), body: textarea('article_body') }))
        .status,
    ).toBe(303)
    let after = await saved()
    expect(after.article.title).toBe('Second')
    expect(after.article.body).toBe(body)
    expect(after.caption).toBe(caption)

    // Blank Markdown still counts as missing.
    let blank = await save('Third', { caption: '  \n ', body: ' \n\n ' })
    expect(blank.status).toBe(400)
    expect(await blank.text()).toMatch(/Article body: Articles need a body/)
  })

  it('deletes a post from its edit page', async () => {
    let id = 'deleteme00'
    await app.run(
      Effect.flatMap(PostCommands, (commands) =>
        commands.publish({
          post: { id, type: 'text', date: '2026-10-01T09:00:00Z', caption: 'Bye' },
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
    expect(await (await app.adminFetch('/admin/posts/new')).text()).not.toMatch(/delete-post/)

    let path = `/admin/posts/${id}/delete`
    expect((await app.fetch(path, { method: 'POST' })).status).toBe(302)
    expect(await findPost(id)).toBeDefined()

    let response = await app.adminFetch(path, { method: 'POST' })
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe('/admin')
    expect((await app.fetch(`/posts/${id}`)).status).toBe(404)
    expect(await hasPostFile(id, 'a.jpg')).toBe(false)
    expect((await app.adminFetch(path, { method: 'POST' })).status).toBe(404)
  })

  // A post form with files, sent as multipart/form-data the way the browser sends it. A file
  // input left empty sends a nameless, empty file.
  let multipartForm = (fields: Record<string, string>, files: [string, File][] = []) => {
    let body = new FormData()
    for (let [name, value] of Object.entries(fields)) body.append(name, value)
    for (let [name, file] of files) body.append(name, file)
    return body
  }
  let noFile = () => new File([], '', { type: 'application/octet-stream' })

  it('the post form uploads files', async () => {
    let post = await samplePost('photos')
    let html = await (await app.adminFetch(`/admin/posts/${post.id}/edit`)).text()
    expect(html).toMatch(
      new RegExp(
        `<form method="post" action="/admin/posts/${post.id}/edit" enctype="multipart/form-data"`,
      ),
    )
    expect(html).toMatch(/<input type="file" name="photo_upload"/)
    expect(html).toMatch(/<input [^>]*name="photo_uploads" type="file"[^>]*multiple/)
  })

  it('publishes the files chosen in the composer without Datastar', async () => {
    let id = 'uploadnew1'
    let response = await app.adminFetch('/admin/posts/new', {
      method: 'POST',
      body: multipartForm({ post_id: id, caption: '' }, [
        ['image_uploads', new File(['one'], 'My Photo.jpg', { type: 'image/jpeg' })],
        ['image_uploads', new File(['two'], 'two.png', { type: 'image/png' })],
        ['image_uploads', new File(['three'], 'three.webp', { type: 'text/html' })],
        ['video_upload', noFile()],
      ]),
    })
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

  it('an edit can replace a video and upload files for an article body', async () => {
    let video = await samplePost('video')
    let response = await app.adminFetch(`/admin/posts/${video.id}/edit`, {
      method: 'POST',
      body: multipartForm({ date: '2026-10-21T09:30', video_file: 'flower.mp4' }, [
        ['video_upload', new File(['new video'], 'garden.mp4')],
        ['video_poster_upload', noFile()],
      ]),
    })
    expect(response.status).toBe(303)
    let saved = await findPost(video.id)
    expect(saved?.type === 'video' && saved.video.src).toBe(`/posts/${video.id}/garden.mp4`)
    expect(saved?.type === 'video' && saved.video.poster).toBeUndefined()

    let article = await samplePost('article')
    let edit = await app.adminFetch(`/admin/posts/${article.id}/edit`, {
      method: 'POST',
      body: multipartForm(
        {
          date: '2026-10-21T09:30',
          article_title: article.article.title,
          article_summary: article.article.summary,
          article_body: 'A chart:\n\n![Chart](chart.png)',
        },
        [
          ['article_uploads', new File(['png'], 'chart.png')],
          ['cover_upload', noFile()],
        ],
      ),
    })
    expect(edit.status).toBe(303)
    expect(await hasPostFile(article.id, 'chart.png')).toBe(true)
    let page = await (await app.adminFetch(`/admin/posts/${article.id}/edit`)).text()
    expect(page).toContain(`<a href="/posts/${article.id}/chart.png"><code>chart.png</code>`)
  })

  it('rejects files that aren’t photos or videos, and keeps the ones that are', async () => {
    let id = 'uploadbad1'
    let response = await app.adminFetch('/admin/posts/new', {
      method: 'POST',
      body: multipartForm({ post_id: id }, [
        ['video_upload', new File(['v'], 'clip.mp4')],
        ['image_uploads', new File(['<svg/>'], 'poster.svg')],
      ]),
    })
    let html = await response.text()
    expect(response.status).toBe(400)
    expect(html).toMatch(/“poster\.svg” can’t be added here/)
    expect(await findPost(id)).toBeUndefined()
    expect(await hasPostFile(id, 'poster.svg')).toBe(false)
    // The video was saved, so the composer comes back with it, and posting again publishes.
    expect(await hasPostFile(id, 'clip.mp4')).toBe(true)
    expect(html).toContain('<input type="hidden" name="video" value="clip.mp4">')
  })

  it('sends a resubmitted composer to the published post, without replacing its files', async () => {
    let post = await firstPost()
    await savePostFile(post.id, 'same.jpg', new File(['original'], 'same.jpg'))
    let response = await app.adminFetch('/admin/posts/new', {
      method: 'POST',
      body: multipartForm({ post_id: post.id, caption: 'Again' }, [
        ['image_uploads', new File(['replaced'], 'same.jpg')],
      ]),
    })
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe(`/posts/${post.id}`)
    expect(await (await app.fetch(`/posts/${post.id}/same.jpg`)).text()).toBe('original')
  })

  it('answers a form with too many files with a page saying so', async () => {
    let post = await samplePost('text')
    let files = Array.from({ length: 101 }, (): [string, File] => ['photo_upload', noFile()])
    let response = await app.adminFetch(`/admin/posts/${post.id}/edit`, {
      method: 'POST',
      body: multipartForm(Object.fromEntries(textPostForm({ caption: 'Too many' })), files),
    })
    expect(response.status).toBe(413)
    expect(await response.text()).toMatch(/Upload too large/)
    expect((await findPost(post.id))?.caption).not.toBe('Too many')
  })

  it('answers a form over the total size before reading it', async () => {
    let post = await samplePost('text')
    let response = await app.adminFetch(`/admin/posts/${post.id}/edit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=x',
        'Content-Length': String(121 * 1024 * 1024),
      },
      body: '--x--',
    })
    expect(response.status).toBe(413)
  })

  it('editing an unknown post is a 404', async () => {
    expect((await app.adminFetch('/admin/posts/nosuchpost/edit')).status).toBe(404)
  })
})

describe('the composer', () => {
  let photo = (name: string) =>
    new File([Bun.file('test/content/posts/drdp3ei6fd/hike-1.jpg')], name, { type: 'image/jpeg' })
  // The composer's form, as Datastar (or the browser) posts it.
  let composerPost = (path: string, fields: [string, string | File][]) => {
    let body = new FormData()
    for (let [name, value] of fields) body.append(name, value)
    return app.adminFetch(path, { method: 'POST', body })
  }

  it('needs an admin login', async () => {
    let response = await app.fetch('/admin/posts/new')
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('/admin/login')
    let body = new FormData()
    body.append('post_id', 'composer01')
    body.append('image_uploads', photo('a.jpg'))
    let media = await app.fetch('/admin/posts/new/media', { method: 'POST', body })
    expect(media.status).toBe(302)
    expect(await hasPostFile('composer01', 'a.jpg')).toBe(false)
  })

  it('starts a new post, as a plain form run by Datastar', async () => {
    let html = await (await app.adminFetch('/admin/posts/new')).text()
    expect(html).toMatch(
      /<form method="post" action="\/admin\/posts\/new" enctype="multipart\/form-data"/,
    )
    expect(html).toMatch(/<input type="hidden" name="post_id" value="[0-9a-z]{10}"/)
    expect(html).not.toMatch(/name="(date|city)"/)
    expect(html).toMatch(/<input type="file" name="image_uploads" accept="image\/\*" multiple/)
    let datastar = capture(html, /<script type="module" src="(\/assets\/datastar\.[0-9a-f]+\.js)"/)
    expect((await app.fetch(datastar)).status).toBe(200)
  })

  it('uploads photos as they’re chosen, renaming ones whose names are taken', async () => {
    let id = 'composer02'
    await composerPost('/admin/posts/new/media', [
      ['post_id', id],
      ['image_uploads', photo('image.jpg')],
    ])
    let response = await composerPost('/admin/posts/new/media', [
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
    // The composer shows them before the post is published, and nobody else sees them.
    expect(events).toContain(`/admin/posts/${id}/files/image-2.jpg`)
    let file = await app.adminFetch(`/admin/posts/${id}/files/image-2.jpg`)
    expect(file.status).toBe(200)
    expect(file.headers.get('Content-Type')).toBe('image/jpeg')
    expect((await app.fetch(`/admin/posts/${id}/files/image-2.jpg`)).status).toBe(302)
    expect((await app.fetch(`/posts/${id}/image-2.jpg`)).status).toBe(404)
  })

  it('removes media, and a video’s poster with it, and deletes their files', async () => {
    let id = 'composer03'
    for (let name of ['a.jpg', 'b.jpg', 'clip.mp4', 'clip.jpg']) {
      await savePostFile(id, name, Bun.file('test/content/posts/drdp3ei6fd/hike-1.jpg'))
    }
    let photos = await (
      await composerPost('/admin/posts/new/media', [
        ['post_id', 'composer03'],
        ['photo', 'a.jpg'],
        ['photo', 'b.jpg'],
        ['remove', 'a.jpg'],
      ])
    ).text()
    expect(photos).not.toContain('value="a.jpg"')
    expect(photos).toContain('<input type="hidden" name="photo" value="b.jpg">')

    let video = await (
      await composerPost('/admin/posts/new/media', [
        ['post_id', 'composer03'],
        ['video', 'clip.mp4'],
        ['poster', 'clip.jpg'],
        ['remove', 'clip.mp4'],
      ])
    ).text()
    expect(video).not.toMatch(/name="(video|poster)"/)
    expect(await hasPostFile(id, 'a.jpg')).toBe(false)
    expect(await hasPostFile(id, 'b.jpg')).toBe(true)
    expect(await hasPostFile(id, 'clip.mp4')).toBe(false)
    expect(await hasPostFile(id, 'clip.jpg')).toBe(false)
  })

  it('takes photos or a video, not both', async () => {
    let events = await (
      await composerPost('/admin/posts/new/media', [
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

  it('previews the post as it’s written, without publishing it', async () => {
    let events = await (
      await composerPost('/admin/posts/new/preview', [
        ['post_id', 'composer05'],
        ['caption', 'Hello **world**'],
      ])
    ).text()
    expect(events).toContain('data: selector #composer-preview\ndata: mode inner\n')
    expect(events).toContain('<strong>world</strong>')
    expect(await findPost('composer05')).toBeUndefined()
  })

  it('publishes a photos post dated now, in UTC, with file names as alt text', async () => {
    let id = 'composer06'
    await composerPost('/admin/posts/new/media', [
      ['post_id', id],
      ['image_uploads', photo('peak.jpg')],
    ])
    let before = Date.now()
    let response = await composerPost('/admin/posts/new', [
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
    // It's published, so the composer can't change its files.
    let late = await composerPost('/admin/posts/new/media', [
      ['post_id', id],
      ['image_uploads', photo('late.jpg')],
    ])
    expect(await late.text()).toMatch(/already published/)
    expect(await hasPostFile(id, 'late.jpg')).toBe(false)
  })

  it('publishes a video with its poster', async () => {
    let id = 'composer07'
    await composerPost('/admin/posts/new/media', [
      ['post_id', id],
      ['video_upload', new File(['v'], 'clip.mp4', { type: 'video/mp4' })],
    ])
    let events = await (
      await composerPost('/admin/posts/new/media', [
        ['post_id', id],
        ['video', 'clip.mp4'],
        ['image_uploads', photo('clip.jpg')],
      ])
    ).text()
    expect(events).toContain('<input type="hidden" name="poster" value="clip.jpg">')
    // With a video, the photo button adds its poster.
    let response = await composerPost('/admin/posts/new', [
      ['post_id', id],
      ['video', 'clip.mp4'],
      ['poster', 'clip.jpg'],
    ])
    expect(response.status).toBe(303)
    let post = await findPost(id)
    expect(post?.type === 'video' && post.video.src).toBe(`/posts/${id}/clip.mp4`)
    expect(post?.type === 'video' && post.video.poster).toMatch(`/posts/${id}/clip.jpg`)
  })

  it('won’t publish an empty post', async () => {
    let page = await composerPost('/admin/posts/new', [
      ['post_id', 'composer08'],
      ['caption', '  \n'],
    ])
    expect(page.status).toBe(400)
    expect(await page.text()).toMatch(/Write something, or add photos or a video/)
    expect(await findPost('composer08')).toBeUndefined()
  })

  it('says when files are too big to upload', async () => {
    let response = await app.adminFetch('/admin/posts/new/media', {
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=x',
        'Content-Length': String(121 * 1024 * 1024),
      },
      body: '--x--',
    })
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

function unescapeHtml(html: string) {
  return html
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
}
