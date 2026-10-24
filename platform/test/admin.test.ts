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
      offset: '+05:30',
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
    expect(saved?.date).toBe('2026-10-21T09:30:00+05:30')
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
        body: textPostForm({ id, caption: 'A brand new post' }),
      })
    let response = await submit()
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe(`/posts/${id}`)
    expect(await (await app.fetch('/')).text()).toMatch(/A brand new post/)

    let again = await submit()
    expect(again.status).toBe(400)
    expect(await again.text()).toMatch(/already published/)
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
      body: multipartForm({ id, offset: '+05:30', caption: '' }, [
        ['photo_uploads', new File(['one'], 'My Photo.jpg', { type: 'image/jpeg' })],
        ['photo_uploads', new File(['two'], 'two.png', { type: 'image/png' })],
        ['photo_uploads', new File(['three'], 'three.webp', { type: 'text/html' })],
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
      body: multipartForm(
        { date: '2026-10-21T09:30', offset: '+05:30', video_file: 'flower.mp4' },
        [
          ['video_upload', new File(['new video'], 'garden.mp4')],
          ['video_poster_upload', noFile()],
        ],
      ),
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
          offset: '+05:30',
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
      body: multipartForm({ id, offset: '+05:30' }, [
        ['video_upload', new File(['v'], 'clip.mp4')],
        ['poster_upload', new File(['<svg/>'], 'poster.svg')],
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

  it('doesn’t let a resubmitted composer replace the published post’s files', async () => {
    let post = await firstPost()
    await savePostFile(post.id, 'same.jpg', new File(['original'], 'same.jpg'))
    let response = await app.adminFetch('/admin/posts/new', {
      method: 'POST',
      body: multipartForm({ id: post.id, offset: '+05:30', caption: 'Again' }, [
        ['photo_uploads', new File(['replaced'], 'same.jpg')],
      ]),
    })
    expect(response.status).toBe(400)
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
  let composerForm = (fields: [string, string | File][]) => {
    let body = new FormData()
    for (let [name, value] of fields) body.append(name, value)
    return body
  }
  let datastar = { 'Datastar-Request': 'true' }
  let composerPost = (
    path: string,
    fields: [string, string | File][],
    headers: Record<string, string> = datastar,
  ) => app.adminFetch(path, { method: 'POST', headers, body: composerForm(fields) })

  it('needs an admin login', async () => {
    let response = await app.fetch('/admin/posts/new')
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('/admin/login')
    let media = await app.fetch('/admin/posts/new/media', {
      method: 'POST',
      body: composerForm([
        ['id', 'composer01'],
        ['photo_uploads', photo('a.jpg')],
      ]),
    })
    expect(media.status).toBe(302)
    expect(await hasPostFile('composer01', 'a.jpg')).toBe(false)
  })

  it('runs in its component, whose module brings Datastar along through the import map', async () => {
    let html = await (await app.adminFetch('/admin/posts/new')).text()
    let nonce = capture(html, /<html [^>]*data-nonce="([^"]+)"/)
    let datastar = capture(html, /"datastar":"(\/assets\/datastar\.[0-9a-f]{12}\.js)"/)
    expect(html).toContain(`<script type="importmap" nonce="${nonce}">`)
    // Only the composer's module: a second module script would let Datastar see the component's
    // `$$signals` before Rocket scopes them.
    let scripts = [...html.matchAll(/<script type="module" src="([^"]+)" nonce="([^"]+)"/g)]
    expect(scripts.map(([, src, scriptNonce]) => [src?.split('.')[0], scriptNonce])).toEqual([
      ['/assets/composer', nonce],
    ])
    let module = await app.fetch(capture(html, /<script type="module" src="([^"]+)"/))
    expect(module.headers.get('Content-Type')).toBe('text/javascript; charset=utf-8')
    expect(module.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    let code = await module.text()
    expect(code).toMatch(/^import \{[^}]*\brocket\b[^}]*\} from "datastar";/)
    expect(code).toContain('rocket("logspace-composer"')
    expect((await app.fetch(datastar)).status).toBe(200)
    // Every signal and action is inside the component, which scopes them.
    let component = capture(html, /(<logspace-composer [\s\S]*<\/logspace-composer>)/)
    let outside = html.replace(component, '')
    expect(component).toContain('data-attr:disabled="$$uploading || $$posting || $$published"')
    expect(outside).not.toContain('$$')
    expect(outside).not.toMatch(/="@\w+\(/)
    // Other pages load Datastar alone, without an import map.
    let home = await (await app.fetch('/')).text()
    expect(home).not.toContain('importmap')
    expect(home).toContain(`<script type="module" src="${datastar}"`)
  })

  it('starts a new post at the newest post’s UTC offset, with no date to edit', async () => {
    let html = await (await app.adminFetch('/admin/posts/new')).text()
    expect(html).toMatch(/<form id="composer" method="post" action="\/admin\/posts\/new"/)
    expect(html).toMatch(/<input type="hidden" name="post_id" value="[0-9a-z]{10}"/)
    expect(html).toMatch(/<input type="hidden" name="offset" value="\+05:30"/)
    expect(html).not.toMatch(/name="date"/)
    expect(html).toMatch(/<input type="file" name="photo_uploads" accept="image\/\*" multiple/)
  })

  it('uploads photos as they’re chosen, renaming ones whose names are taken', async () => {
    let id = 'composer02'
    await composerPost('/admin/posts/new/media', [
      ['id', id],
      ['photo_uploads', photo('image.jpg')],
    ])
    let response = await composerPost('/admin/posts/new/media', [
      ['id', id],
      ['photo', 'image.jpg'],
      ['photo_uploads', photo('image.jpg')],
      ['photo_uploads', photo('My Photo.jpg')],
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
    let draft = await app.adminFetch(`/admin/posts/${id}/files/image-2.jpg`)
    expect(draft.status).toBe(200)
    expect(draft.headers.get('Content-Type')).toBe('image/jpeg')
    expect((await app.fetch(`/admin/posts/${id}/files/image-2.jpg`)).status).toBe(302)
    expect((await app.fetch(`/posts/${id}/image-2.jpg`)).status).toBe(404)
  })

  it('removes media, and a video’s poster with it', async () => {
    let photos = await (
      await composerPost('/admin/posts/new/media', [
        ['id', 'composer03'],
        ['photo', 'a.jpg'],
        ['photo', 'b.jpg'],
        ['remove', 'a.jpg'],
      ])
    ).text()
    expect(photos).not.toContain('value="a.jpg"')
    expect(photos).toContain('<input type="hidden" name="photo" value="b.jpg">')

    let video = await (
      await composerPost('/admin/posts/new/media', [
        ['id', 'composer03'],
        ['video', 'clip.mp4'],
        ['poster', 'clip.jpg'],
        ['remove', 'clip.mp4'],
      ])
    ).text()
    expect(video).not.toMatch(/name="(video|poster)"/)
  })

  it('deletes the files of media taken out, and only those', async () => {
    let id = 'composer11'
    let media = (fields: [string, string | File][]) =>
      composerPost('/admin/posts/new/media', [['id', id], ...fields])
    await media([
      ['photo_uploads', photo('a.jpg')],
      ['photo_uploads', photo('b.jpg')],
    ])
    await app.adminFetch(`/admin/posts/${id}/files/a.jpg?w=320&v=x`)
    await media([
      ['photo', 'a.jpg'],
      ['photo', 'b.jpg'],
      ['remove', 'a.jpg'],
    ])
    expect(await hasPostFile(id, 'a.jpg')).toBe(false)
    expect(await hasPostFile(id, 'b.jpg')).toBe(true)
    let info = await app.run(
      Effect.flatMap(PostQueries, (queries) => queries.imageInfo(id, 'a.jpg')),
    )
    expect(info).toBeUndefined()

    // A removed article takes its cover and the files its body used, but not a link that can't
    // be a file.
    await media([
      ['photo', 'b.jpg'],
      ['remove', 'b.jpg'],
    ])
    await media([
      ['article_body', 'Hi ![Desk](desk.jpg) and [notes](notes/today)'],
      ['article_files', photo('desk.jpg')],
      ['cover_upload', photo('cover.jpg')],
    ])
    expect(await hasPostFile(id, 'desk.jpg')).toBe(true)
    let removed = await media([
      ['article_body', 'Hi ![Desk](desk.jpg) and [notes](notes/today)'],
      ['cover', 'cover.jpg'],
      ['remove_article', 'article'],
    ])
    expect(removed.status).toBe(200)
    expect(await hasPostFile(id, 'desk.jpg')).toBe(false)
    expect(await hasPostFile(id, 'cover.jpg')).toBe(false)
    expect(await hasPostFile(id, 'b.jpg')).toBe(false)
  })

  it('takes one kind of media at a time', async () => {
    let events = await (
      await composerPost('/admin/posts/new/media', [
        ['id', 'composer04'],
        ['photo', 'a.jpg'],
        ['video_upload', new File(['v'], 'clip.mp4', { type: 'video/mp4' })],
      ])
    ).text()
    expect(events).toContain('data: selector #composer-issues')
    expect(events).toMatch(/A post can have photos, a video, or an article, but only one/)
    expect(events).not.toMatch(/name="video"/)
    expect(await hasPostFile('composer04', 'clip.mp4')).toBe(false)
  })

  it('previews the post as it’s written, without publishing it', async () => {
    let events = await (
      await composerPost('/admin/posts/new/preview', [
        ['id', 'composer05'],
        ['offset', '-07:00'],
        ['city', 'Lisbon'],
        ['caption', 'Hello **world**'],
      ])
    ).text()
    expect(events).toContain('data: selector #composer-preview\n')
    expect(events).toContain('<strong>world</strong>')
    expect(events).toMatch(/ · Lisbon/)
    expect(events).toMatch(/datetime="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-07:00"/)
    expect(await findPost('composer05')).toBeUndefined()
  })

  it('publishes a photos post dated now, with its file names as alt text', async () => {
    let id = 'composer06'
    await composerPost('/admin/posts/new/media', [
      ['id', id],
      ['photo_uploads', photo('peak.jpg')],
    ])
    let before = Date.now()
    let response = await composerPost(
      '/admin/posts/new',
      [
        ['id', id],
        ['offset', '+05:30'],
        ['caption', 'Up top'],
        ['city', ''],
        ['photo', 'peak.jpg'],
      ],
      {},
    )
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe(`/posts/${id}`)
    let post = defined(await findPost(id), 'the post')
    expect(post.type).toBe('photos')
    expect(post.caption).toBe('Up top')
    expect(post.city).toBeUndefined()
    expect(post.type === 'photos' && post.photos.map((photo) => photo.alt)).toEqual(['peak.jpg'])
    expect(post.date).toMatch(/\+05:30$/)
    expect(Math.abs(Date.parse(post.date) - before)).toBeLessThan(5_000)
    expect((await app.fetch(`/posts/${id}/peak.jpg`)).status).toBe(200)
    // It's published, so the composer can't change its files.
    let late = await composerPost('/admin/posts/new/media', [
      ['id', id],
      ['photo_uploads', photo('late.jpg')],
    ])
    expect(await late.text()).toMatch(/already published/)
    expect(await hasPostFile(id, 'late.jpg')).toBe(false)
  })

  it('sends Datastar to the post once it’s published', async () => {
    let id = 'composer07'
    let events = await (
      await composerPost('/admin/posts/new', [
        ['id', id],
        ['offset', '+00:00'],
        ['caption', 'Just text'],
      ])
    ).text()
    expect(events).toContain(`data-redirect="/posts/${id}"`)
    expect((await findPost(id))?.type).toBe('text')
  })

  it('won’t publish an empty post', async () => {
    let fields: [string, string][] = [
      ['id', 'composer08'],
      ['caption', '  \n'],
    ]
    let page = await composerPost('/admin/posts/new', fields, {})
    expect(page.status).toBe(400)
    expect(await page.text()).toMatch(/Write something, or add photos, a video, or an article/)
    let events = await (await composerPost('/admin/posts/new', fields)).text()
    expect(events).toMatch(/Write something, or add photos, a video, or an article/)
    expect(await findPost('composer08')).toBeUndefined()
  })

  it('says when files are too big to upload', async () => {
    let response = await app.adminFetch('/admin/posts/new/media', {
      method: 'POST',
      headers: {
        ...datastar,
        'Content-Type': 'multipart/form-data; boundary=x',
        'Content-Length': String(121 * 1024 * 1024),
      },
      body: '--x--',
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toMatch(/too big to upload/)
  })

  it('makes an article from a Markdown file, and uploads the files it uses', async () => {
    let id = 'composer09'
    let markdown = '# A year of notes\n\nIt went well.\n\n![My desk](desk.jpg)\n'
    let added = await (
      await composerPost('/admin/posts/new/media', [
        ['id', id],
        ['article_upload', new File([markdown], 'notes.md', { type: 'text/markdown' })],
      ])
    ).text()
    expect(added).toMatch(/<input name="article_title" value="A year of notes"/)
    expect(added).toContain('From notes.md · 5 words')
    expect(added).toContain('<span class="missing-file">desk.jpg</span>')
    expect(added).toMatch(/<textarea hidden name="article_body">/)
    // Only photos can go with it, as its cover; the video button is off.
    expect(added).toMatch(/<input type="file" name="cover_upload"/)
    expect(added).toMatch(/<input type="file" name="video_upload"[^>]* disabled/)

    let body = '\nIt went well.\n\n![My desk](desk.jpg)\n'
    let article: [string, string][] = [
      ['id', id],
      ['offset', '+05:30'],
      ['article_title', 'A year of notes'],
      ['article_summary', 'What I learned'],
      ['article_body', body],
      ['article_source', 'notes.md'],
    ]
    let uploaded = await (
      await composerPost('/admin/posts/new/media', [
        ...article,
        ['article_files', photo('desk.jpg')],
      ])
    ).text()
    expect(uploaded).not.toContain('missing-file')
    expect(await hasPostFile(id, 'desk.jpg')).toBe(true)
    let preview = await (await composerPost('/admin/posts/new/preview', article)).text()
    expect(preview).toContain('<h1 class="page-title">A year of notes</h1>')
    expect(preview).toContain(`src="/admin/posts/${id}/files/desk.jpg?v=`)

    let response = await composerPost('/admin/posts/new', article, {})
    expect(response.status).toBe(303)
    let post = defined(await findPost(id), 'the article')
    expect(post.type === 'article' && post.article).toMatchObject({
      title: 'A year of notes',
      summary: 'What I learned',
    })
    expect(await (await app.fetch(`/posts/${id}`)).text()).toContain(`/posts/${id}/desk.jpg`)
  })

  it('discards a post, deleting what was uploaded for it', async () => {
    let id = 'composer10'
    await composerPost('/admin/posts/new/media', [
      ['id', id],
      ['photo_uploads', photo('a.jpg')],
    ])
    let page = await (await app.adminFetch('/admin/posts/new')).text()
    expect(page).toMatch(/<dialog id="discard-post"/)
    expect(page).toMatch(/<form method="post" action="\/admin\/posts\/new\/discard"/)
    let discard = (id: string) =>
      app.adminFetch('/admin/posts/new/discard', {
        method: 'POST',
        body: new URLSearchParams({ id }),
      })
    let response = await discard(id)
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe('/admin/posts/new')
    expect(await hasPostFile(id, 'a.jpg')).toBe(false)
    // A published post's files stay.
    let published = await samplePost('photos')
    await discard(published.id)
    expect(await hasPostFile(published.id, 'hike-1.jpg')).toBe(true)
  })

  describe('drafts', () => {
    let draftIds = () =>
      app.run(
        Effect.flatMap(
          SqlClient.SqlClient,
          (sql) => sql<{ id: string }>`select id from drafts`,
        ).pipe(
          Effect.orDie,
          Effect.map((rows) => rows.map((row) => row.id)),
        ),
      )
    let insertDraft = (id: string, data: string) =>
      app.run(
        Effect.flatMap(
          SqlClient.SqlClient,
          (sql) =>
            sql`insert into drafts ${sql.insert({ id, data, updated_at: '2026-10-24T00:00:00Z' })}`,
        ).pipe(Effect.orDie),
      )
    // The composer as GET /admin/posts/new shows it: its post's id, and the page.
    let openComposer = async () => {
      let html = await (await app.adminFetch('/admin/posts/new')).text()
      return {
        id: capture(html, /<input type="hidden" name="post_id" value="([0-9a-z]{10})"/),
        html,
      }
    }
    let captionOf = (html: string) =>
      unescapeHtml(capture(html, /<textarea name="caption"[^>]*>\n([^<]*)<\/textarea>/))
    let discard = (id: string) =>
      app.adminFetch('/admin/posts/new/discard', {
        method: 'POST',
        body: new URLSearchParams({ id }),
      })

    it('saves what’s written, and the composer picks it up again', async () => {
      let id = 'drafted001'
      let media = await (
        await composerPost('/admin/posts/new/media', [
          ['id', id],
          ['offset', '+05:30'],
          ['caption', 'Morning'],
          ['photo_uploads', photo('a.jpg')],
        ])
      ).text()
      expect(media).toContain('data: selector #composer-draft\n')
      expect(media).toContain('>Saved</span>')
      let preview = await (
        await composerPost('/admin/posts/new/preview', [
          ['id', id],
          ['offset', '+05:30'],
          ['caption', 'Morning <walk> & tea\r\n\r\nWith friends'],
          ['city', 'Pune'],
          ['photo', 'a.jpg'],
        ])
      ).text()
      expect(preview).toContain('>Saved</span>')
      // What was saved becomes the fields' defaults, so a morph keeps only unsaved typing.
      expect(JSON.parse(unescapeHtml(capture(preview, /data-saved-values="([^"]*)"/)))).toEqual({
        caption: 'Morning <walk> & tea\n\nWith friends',
        city: 'Pune',
        article_title: '',
        article_summary: '',
      })
      expect(await draftIds()).toEqual([id])

      let { id: resumed, html } = await openComposer()
      expect(resumed).toBe(id)
      expect(captionOf(html)).toBe('Morning <walk> & tea\n\nWith friends')
      expect(html).toMatch(/<input name="city" value="Pune"/)
      expect(html).toContain('<input type="hidden" name="photo" value="a.jpg">')
      expect(html).toContain(`src="/admin/posts/${id}/files/a.jpg?v=`)
      expect(html).toContain('>Saved</span>')

      // An article, too, with what's typed into its title and summary.
      let article = 'article001'
      await composerPost('/admin/posts/new/media', [
        ['id', article],
        ['offset', '+05:30'],
        [
          'article_upload',
          new File(['# Notes\n\nIt went **well**.\n'], 'notes.md', { type: 'text/markdown' }),
        ],
      ])
      await composerPost('/admin/posts/new/preview', [
        ['id', article],
        ['offset', '+05:30'],
        ['caption', 'New article'],
        ['article_title', 'Notes, revised'],
        ['article_summary', 'What went well'],
        ['article_body', '\nIt went **well**.\n'],
        ['article_source', 'notes.md'],
      ])
      let page = await openComposer()
      expect(page.id).toBe(article)
      expect(captionOf(page.html)).toBe('New article')
      expect(page.html).toMatch(/<input name="article_title" value="Notes, revised"/)
      expect(page.html).toMatch(/<input name="article_summary" value="What went well"/)
      expect(page.html).toContain('<textarea hidden name="article_body">\n\nIt went **well**.\n')
      expect(page.html).toContain('<input type="hidden" name="article_source" value="notes.md">')
      expect(page.html).toContain('<h1 class="page-title">Notes, revised</h1>')
    })

    it('doesn’t save an empty composer over nothing', async () => {
      let empty: [string, string][] = [
        ['id', 'emptydraft'],
        ['offset', '+05:30'],
        ['caption', ' \n'],
        ['city', ''],
      ]
      let events = await (await composerPost('/admin/posts/new/preview', empty)).text()
      expect(events).toContain(
        '<span id="composer-draft" role="status" class="muted draft-note"></span>',
      )
      expect(await draftIds()).toEqual([])
      // Nor over another post's draft, as a composer opened before it was saved would.
      await composerPost('/admin/posts/new/preview', [
        ['id', 'drafted002'],
        ['caption', 'Hi'],
      ])
      await composerPost('/admin/posts/new/preview', empty)
      expect(await draftIds()).toEqual(['drafted002'])
      // But its own draft can be emptied.
      await composerPost('/admin/posts/new/preview', [['id', 'drafted002']])
      let { id, html } = await openComposer()
      expect(id).toBe('drafted002')
      expect(captionOf(html)).toBe('')
    })

    it('is cleared by publishing, and the next visit starts afresh', async () => {
      let id = 'drafted003'
      await composerPost('/admin/posts/new/media', [
        ['id', id],
        ['offset', '+05:30'],
        ['photo_uploads', photo('a.jpg')],
      ])
      let fields: [string, string][] = [
        ['id', id],
        ['offset', '+05:30'],
        ['caption', 'Posted'],
        ['photo', 'a.jpg'],
      ]
      await composerPost('/admin/posts/new/preview', fields)
      expect(await draftIds()).toEqual([id])
      expect((await composerPost('/admin/posts/new', fields, {})).status).toBe(303)
      expect(await draftIds()).toEqual([])
      let { id: next, html } = await openComposer()
      expect(next).not.toBe(id)
      expect(captionOf(html)).toBe('')
      expect(html).not.toMatch(/name="photo"/)
      // A preview sent as it was published, that arrives after, doesn't bring it back.
      let late = await (await composerPost('/admin/posts/new/preview', fields)).text()
      expect(late).toContain('>Not saved</span>')
      expect(await draftIds()).toEqual([])
      expect(await hasPostFile(id, 'a.jpg')).toBe(true)
    })

    it('is cleared by discarding, with its files', async () => {
      let id = 'drafted004'
      let fields: [string, string][] = [
        ['id', id],
        ['caption', 'Never mind'],
        ['photo', 'a.jpg'],
      ]
      await composerPost('/admin/posts/new/media', [
        ['id', id],
        ['photo_uploads', photo('a.jpg')],
      ])
      await composerPost('/admin/posts/new/preview', fields)
      expect((await discard(id)).status).toBe(303)
      expect(await draftIds()).toEqual([])
      expect(await hasPostFile(id, 'a.jpg')).toBe(false)
      expect((await openComposer()).id).not.toBe(id)
      // A tab left open on it can't bring it back, now that its photo is gone, nor upload more.
      let stale = await (await composerPost('/admin/posts/new/preview', fields)).text()
      expect(stale).toContain('>Not saved</span>')
      let upload = await (
        await composerPost('/admin/posts/new/media', [...fields, ['photo_uploads', photo('b.jpg')]])
      ).text()
      expect(upload).toMatch(/discarded or replaced in another tab/)
      expect(await hasPostFile(id, 'b.jpg')).toBe(false)
      expect(await draftIds()).toEqual([])
    })

    it('replaces the last draft, deleting its files', async () => {
      let old = 'drafted005'
      await composerPost('/admin/posts/new/media', [
        ['id', old],
        ['photo_uploads', photo('a.jpg')],
      ])
      let next = 'drafted006'
      await composerPost('/admin/posts/new/media', [
        ['id', next],
        ['photo_uploads', photo('b.jpg')],
      ])
      expect(await draftIds()).toEqual([next])
      expect(await hasPostFile(old, 'a.jpg')).toBe(false)
      expect(await hasPostFile(next, 'b.jpg')).toBe(true)
      expect((await openComposer()).id).toBe(next)
      // The old one's tab can't take over again, as its photo is gone.
      let stale = await (
        await composerPost('/admin/posts/new/preview', [
          ['id', old],
          ['photo', 'a.jpg'],
        ])
      ).text()
      expect(stale).toContain('>Not saved</span>')
      expect(await draftIds()).toEqual([next])

      // A published post's files stay, should its id still have a draft.
      let published = await samplePost('photos')
      await insertDraft(published.id, '{}')
      await composerPost('/admin/posts/new/preview', [
        ['id', 'drafted007'],
        ['caption', 'Hi'],
      ])
      expect(await draftIds()).toEqual(['drafted007'])
      expect(await hasPostFile(published.id, 'hike-1.jpg')).toBe(true)
    })

    it('can’t be a published post’s', async () => {
      let published = await samplePost('photos')
      let events = await (
        await composerPost('/admin/posts/new/preview', [
          ['id', published.id],
          ['caption', 'Back to a draft'],
        ])
      ).text()
      expect(events).toContain('>Not saved</span>')
      let media = await (
        await composerPost('/admin/posts/new/media', [
          ['id', published.id],
          ['caption', 'Back to a draft'],
          ['photo', 'hike-1.jpg'],
        ])
      ).text()
      expect(media).toMatch(/already published/)
      expect(await draftIds()).toEqual([])
      expect((await openComposer()).id).not.toBe(published.id)
    })

    describe('in more than one tab', () => {
      // A tab's stream of updates, and the composer each of its events sends, as HTML.
      let openUpdates = async (tab: string) => {
        let response = await app.adminFetch(`/admin/posts/new/updates?tab=${tab}`)
        expect(response.headers.get('Content-Type')).toMatch(/^text\/event-stream/)
        let reader = defined(response.body, 'a stream').pipeThrough(new TextDecoderStream())
        let events = reader.getReader()
        let buffered = ''
        let next = async (): Promise<string> => {
          let end = buffered.indexOf('\n\n')
          if (end === -1) {
            let { value, done } = await events.read()
            if (done) throw new Error('Expected another event')
            buffered += value
            return next()
          }
          let event = buffered.slice(0, end)
          buffered = buffered.slice(end + 2)
          // Comments keep the connection open.
          if (event.startsWith(':')) return next()
          expect(event).toStartWith(
            'event: datastar-patch-elements\ndata: selector #composer-page\ndata: mode outer\n',
          )
          return [...event.matchAll(/^data: elements (.*)$/gm)].map((line) => line[1]).join('\n')
        }
        return { next, close: () => events.cancel() }
      }
      let write = (tab: string, id: string, caption: string) =>
        composerPost('/admin/posts/new/preview', [
          ['id', id],
          ['tab', tab],
          ['offset', '+05:30'],
          ['caption', caption],
        ])

      it('follows what other tabs write, but not its own', async () => {
        let { id, html } = await openComposer()
        let tab = capture(html, /<input type="hidden" name="tab" value="([^"]+)"/)
        expect(html).toContain(`updates-url="/admin/posts/new/updates?tab=${tab}"`)
        let updates = await openUpdates('second-tab')
        // The composer as it is when the stream opens, for this tab.
        let first = await updates.next()
        expect(captionOf(first)).toBe('')
        expect(first).toContain('<input type="hidden" name="tab" value="second-tab">')

        await write(tab, id, 'From the first tab')
        let next = await updates.next()
        expect(capture(next, /name="post_id" value="([0-9a-z]{10})"/)).toBe(id)
        expect(captionOf(next)).toBe('From the first tab')
        expect(next).toContain('>Saved</span>')

        // Reopening reconciles even its own latest write: that response could have been lost.
        // Subsequent changes from this tab still aren't echoed back.
        await updates.close()
        await write('second-tab', id, 'From the second tab')
        updates = await openUpdates('second-tab')
        expect(captionOf(await updates.next())).toBe('From the second tab')
        let waiting = updates.next()
        await write('second-tab', id, 'Another edit from the second tab')
        let third = await openUpdates('third-tab')
        expect(captionOf(await third.next())).toBe('Another edit from the second tab')
        await third.close()
        await write(tab, id, 'From the first tab again')
        expect(captionOf(await waiting)).toBe('From the first tab again')

        // Once the post is published, it starts a new one.
        let published = await composerPost(
          '/admin/posts/new',
          [
            ['id', id],
            ['tab', tab],
            ['offset', '+05:30'],
            ['caption', 'Posted'],
          ],
          {},
        )
        expect(published.status).toBe(303)
        let fresh = await updates.next()
        expect(capture(fresh, /name="post_id" value="([0-9a-z]{10})"/)).not.toBe(id)
        expect(captionOf(fresh)).toBe('')
        await updates.close()
      })

      it('starts a new post when the draft is discarded', async () => {
        let updates = await openUpdates('second-tab')
        await updates.next()
        await write('first-tab', 'drafted010', 'Never mind')
        expect(captionOf(await updates.next())).toBe('Never mind')
        await discard('drafted010')
        let fresh = await updates.next()
        expect(fresh).not.toContain('drafted010')
        expect(captionOf(fresh)).toBe('')
        await updates.close()
      })

      it('needs an admin login', async () => {
        let response = await app.fetch('/admin/posts/new/updates?tab=second-tab')
        expect(response.status).toBe(302)
      })
    })

    it('ignores a draft that doesn’t decode, and replaces it', async () => {
      for (let data of ['{"id":', '{"id":"drafted008","caption":5}']) {
        await app.seedDatabase()
        await insertDraft('drafted008', data)
        let { id, html } = await openComposer()
        expect(id).not.toBe('drafted008')
        expect(captionOf(html)).toBe('')
      }
      await composerPost('/admin/posts/new/preview', [
        ['id', 'drafted009'],
        ['caption', 'Fresh'],
      ])
      expect(await draftIds()).toEqual(['drafted009'])
    })
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
