import * as assert from 'remix/assert'
import { beforeAll, beforeEach, describe, it } from 'remix/test'

import { adminFetch, fetch } from '../../../../test/client.ts'
import { seedDatabase, seedMedia } from '../../../../test/seed.ts'
import { db } from '../../../data/db.ts'
import { hasPostFile, savePostFile } from '../../../data/media.ts'
import { createPost } from '../../../data/posts/mutations.ts'
import type { Post } from '../../../data/posts/presentation.ts'
import { getPosts } from '../../../data/posts/store.ts'
import { posts } from '../../../data/tables.ts'
import { routes } from '../../../routes.ts'

beforeAll(seedMedia)
beforeEach(seedDatabase)

describe('admin post pages', () => {
  // A text post's form fields, as the browser sends them.
  function textPostForm(fields: Record<string, string> = {}) {
    return new URLSearchParams({
      type: 'text',
      date: '2026-10-21T09:30',
      offset: '+05:30',
      city: '',
      caption: 'Hello\r\nworld',
      ...fields,
    })
  }

  // The sample post of a type.
  async function samplePost<T extends Post['type']>(type: T) {
    let post = (await getPosts()).find((post) => post.type === type)
    return post as Extract<Post, { type: T }>
  }

  async function findPost(id: string) {
    return (await getPosts()).find((post) => post.id === id)
  }

  it('need an admin login', async () => {
    let [post] = await getPosts()
    for (let path of [
      routes.admin.posts.new.index.href(),
      routes.admin.posts.edit.index.href({ id: post.id }),
    ]) {
      let response = await fetch(path)
      assert.equal(response.status, 302, path)
      assert.equal(response.headers.get('Location'), routes.admin.login.href())
    }

    let edit = await fetch(routes.admin.posts.edit.action.href({ id: post.id }), {
      method: 'POST',
      body: textPostForm({ caption: 'Not logged in' }),
    })
    assert.equal(edit.status, 302)
    assert.notEqual((await findPost(post.id))?.caption, 'Not logged in')
  })

  it('/admin links to the new post page and to each post’s edit page', async () => {
    let html = await (await adminFetch(routes.admin.index.href())).text()
    assert.match(html, /href="\/admin\/posts\/new"/)
    for (let post of await getPosts()) {
      assert.match(html, new RegExp(`href="/admin/posts/${post.id}/edit"`))
    }
  })

  it('the edit page starts with the post’s values', async () => {
    let post = await samplePost('photos')
    let html = await (await adminFetch(routes.admin.posts.edit.index.href({ id: post.id }))).text()

    // The type is shown but can't be changed, and only its fields are there.
    assert.doesNotMatch(html, /<input [^>]*name="type"/)
    assert.match(html, /Type: Photos/)
    assert.doesNotMatch(html, /<input [^>]*name="video_file"/)
    assert.match(html, new RegExp(`<input [^>]*name="city"[^>]*value="${post.city}"`))
    assert.match(html, new RegExp(`<textarea [^>]*name="caption"[^>]*>${post.caption}</textarea>`))
    assert.match(html, /<input [^>]*name="photo_file"[^>]*value="hike-1\.jpg"/)
  })

  it('saving an edit updates the post and shows it', async () => {
    let post = await samplePost('text')
    let response = await adminFetch(routes.admin.posts.edit.action.href({ id: post.id }), {
      method: 'POST',
      body: textPostForm({ city: 'Hanoi' }),
    })
    assert.equal(response.status, 303)
    assert.equal(response.headers.get('Location'), routes.posts.show.href({ id: post.id }))

    let saved = await findPost(post.id)
    assert.equal(saved?.caption, 'Hello\nworld')
    assert.equal(saved?.city, 'Hanoi')
    assert.equal(saved?.date, '2026-10-21T09:30:00+05:30')
    let page = await (await fetch(routes.posts.show.href({ id: post.id }))).text()
    assert.match(page, /Hanoi/)
  })

  it('saving photos keeps them in order and drops empty rows', async () => {
    let post = await samplePost('photos')
    let body = textPostForm({ type: 'photos', caption: '' })
    for (let [file, alt] of [
      ['hike-3.jpg', 'Peak'],
      ['', ''],
      ['hike-1.jpg', 'River'],
    ]) {
      body.append('photo_file', file)
      body.append('photo_alt', alt)
    }
    let response = await adminFetch(routes.admin.posts.edit.action.href({ id: post.id }), {
      method: 'POST',
      body,
    })
    assert.equal(response.status, 303)

    let saved = await findPost(post.id)
    assert.equal(saved?.caption, undefined)
    // Their sizes come from the files.
    let photos = saved?.type === 'photos' ? saved.photos : []
    assert.deepEqual(
      photos.map(({ src, alt, width, height }) => ({ src: src.split('?')[0], alt, width, height })),
      [
        { src: `/posts/${post.id}/hike-3.jpg`, alt: 'Peak', width: 24, height: 32 },
        { src: `/posts/${post.id}/hike-1.jpg`, alt: 'River', width: 32, height: 21 },
      ],
    )
  })

  it('rejects an invalid edit with the reasons, and keeps what was typed', async () => {
    let post = await samplePost('video')
    let response = await adminFetch(routes.admin.posts.edit.action.href({ id: post.id }), {
      method: 'POST',
      body: textPostForm({
        type: 'video',
        caption: 'Typed caption',
        video_file: 'missing.mp4',
        video_width: 'wide',
      }),
    })
    let html = await response.text()
    assert.equal(response.status, 400)
    assert.match(html, /role="alert"/)
    assert.match(html, /Video width: Expected a size in pixels/)
    let widthInput = html.match(/<input [^>]*name="video_width"[^>]*>/)?.[0] ?? ''
    assert.match(widthInput, /value="wide"/)
    assert.match(widthInput, /aria-invalid="true"/)
    assert.match(html, /Typed caption/)
    assert.deepEqual(await findPost(post.id), post)

    // Valid fields, but a file that isn't in the post's media.
    let missing = await adminFetch(routes.admin.posts.edit.action.href({ id: post.id }), {
      method: 'POST',
      body: textPostForm({ type: 'video', video_file: 'missing.mp4' }),
    })
    assert.equal(missing.status, 400)
    assert.match(await missing.text(), /missing\.mp4 isn’t one of this post’s files/)
  })

  it('creates a new post, once', async () => {
    let page = await (await adminFetch(routes.admin.posts.new.index.href())).text()
    let id = page.match(/<input [^>]*name="id"[^>]*value="([0-9a-z]{10})"/)?.[1]
    assert.ok(id)

    let submit = () =>
      adminFetch(routes.admin.posts.new.action.href(), {
        method: 'POST',
        body: textPostForm({ id, caption: 'A brand new post' }),
      })
    let response = await submit()
    assert.equal(response.status, 303)
    assert.equal(response.headers.get('Location'), routes.posts.show.href({ id }))
    assert.match(await (await fetch(routes.home.href())).text(), /A brand new post/)

    let again = await submit()
    assert.equal(again.status, 400)
    assert.match(await again.text(), /already published/)
  })

  it('rejects a new text post without a caption', async () => {
    let id = 'zzzzzzzzzz'
    let response = await adminFetch(routes.admin.posts.new.action.href(), {
      method: 'POST',
      body: textPostForm({ id, caption: '  ' }),
    })
    assert.equal(response.status, 400)
    assert.match(await response.text(), /Caption: Text posts need a caption/)
    assert.equal(await findPost(id), undefined)
  })

  it('an edit can’t change the post’s type', async () => {
    let post = await samplePost('text')
    let response = await adminFetch(routes.admin.posts.edit.action.href({ id: post.id }), {
      method: 'POST',
      body: textPostForm({ type: 'article', caption: 'Still text' }),
    })
    assert.equal(response.status, 303)
    let saved = await findPost(post.id)
    assert.equal(saved?.type, 'text')
    assert.equal(saved?.caption, 'Still text')
  })

  it('saves an article’s body in the database', async () => {
    let post = await samplePost('article')
    let edit = routes.admin.posts.edit
    let html = await (await adminFetch(edit.index.href({ id: post.id }))).text()
    assert.match(html, /<textarea [^>]*name="article_body"[^>]*>[^<]*\S/)

    let form = (body: string) =>
      textPostForm({
        type: 'article',
        article_title: post.article.title,
        article_summary: post.article.summary,
        article_body: body,
      })
    let response = await adminFetch(edit.action.href({ id: post.id }), {
      method: 'POST',
      body: form('## Rewritten\r\n\r\nWith ![a desk](desk.jpg) in it.'),
    })
    assert.equal(response.status, 303)
    let saved = await findPost(post.id)
    assert.equal(
      saved?.type === 'article' && saved.article.body,
      '## Rewritten\n\nWith ![a desk](desk.jpg) in it.',
    )
    // Stored in its own column, for search, rather than in the details JSON.
    let row = await db.find(posts, post.id)
    assert.equal(row?.article_body, '## Rewritten\n\nWith ![a desk](desk.jpg) in it.')
    assert.doesNotMatch(row?.details ?? '', /Rewritten/)
    let page = await (await fetch(routes.posts.show.href({ id: post.id }))).text()
    assert.match(page, /<h2[^>]*>Rewritten<\/h2>/)
    assert.match(page, new RegExp(`<img src="/posts/${post.id}/desk\\.jpg"`))

    let empty = await adminFetch(edit.action.href({ id: post.id }), {
      method: 'POST',
      body: form('   '),
    })
    assert.equal(empty.status, 400)
    assert.match(await empty.text(), /Article body: Articles need a body/)
  })

  it('keeps Markdown exactly as typed, through a save and an unrelated edit', async () => {
    let post = await samplePost('article')
    let edit = routes.admin.posts.edit
    // An indented code fence strips its indentation from the code, so the opening line's spaces
    // matter; so do a caption's, where four start a code block.
    let body = '  ```python\n  print("hello")\n  ```\n\nAfter the code.\n'
    let caption = '    indented code\n\nThen text.'
    // Browsers send textarea line breaks as \r\n.
    let crlf = (text: string) => text.replaceAll('\n', '\r\n')
    let save = (title: string, fields: { caption: string; body: string }) =>
      adminFetch(edit.action.href({ id: post.id }), {
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

    assert.equal((await save('First', { caption, body })).status, 303)
    assert.equal((await saved()).article.body, body)
    assert.equal((await saved()).caption, caption)
    let page = await (await fetch(routes.posts.show.href({ id: post.id }))).text()
    assert.match(page, /<code[^>]*>print\(&quot;hello&quot;\)/)

    // Resubmit what the edit page shows, changing only the title.
    let html = await (await adminFetch(edit.index.href({ id: post.id }))).text()
    let textarea = (name: string) =>
      unescapeHtml(
        html.match(new RegExp(`<textarea [^>]*name="${name}"[^>]*>([^<]*)</textarea>`))![1],
      )
    assert.equal(
      (await save('Second', { caption: textarea('caption'), body: textarea('article_body') }))
        .status,
      303,
    )
    let after = await saved()
    assert.equal(after.article.title, 'Second')
    assert.equal(after.article.body, body)
    assert.equal(after.caption, caption)

    // Blank Markdown still counts as missing.
    let blank = await save('Third', { caption: '  \n ', body: ' \n\n ' })
    assert.equal(blank.status, 400)
    assert.match(await blank.text(), /Article body: Articles need a body/)
  })

  it('deletes a post from its edit page', async () => {
    let id = 'deleteme00'
    let post = { id, type: 'text', date: '2026-10-01T09:00:00Z', caption: 'Bye' }
    await createPost({ post, uploads: [], issues: [] })
    await savePostFile(id, 'a.jpg', new File(['a'], 'a.jpg'))
    let edit = await (await adminFetch(routes.admin.posts.edit.index.href({ id }))).text()
    assert.match(edit, /<dialog id="delete-post"/)
    assert.match(edit, /<form method="post" action="\/admin\/posts\/deleteme00\/delete"/)
    assert.match(edit, /command="show-modal"/)
    let newPage = await (await adminFetch(routes.admin.posts.new.index.href())).text()
    assert.doesNotMatch(newPage, /delete-post/)

    let path = routes.admin.posts.delete.href({ id })
    let loggedOut = await fetch(path, { method: 'POST' })
    assert.equal(loggedOut.status, 302)
    assert.ok(await findPost(id))

    let response = await adminFetch(path, { method: 'POST' })
    assert.equal(response.status, 303)
    assert.equal(response.headers.get('Location'), routes.admin.index.href())
    assert.equal((await fetch(routes.posts.show.href({ id }))).status, 404)
    assert.equal(await hasPostFile(id, 'a.jpg'), false)
    assert.equal((await adminFetch(path, { method: 'POST' })).status, 404)
  })

  // A post form with files, sent as multipart/form-data the way the browser sends it. A file
  // input left empty sends a nameless, empty file.
  function multipartForm(fields: Record<string, string>, files: [string, File][] = []) {
    let body = new FormData()
    for (let [name, value] of Object.entries(fields)) body.append(name, value)
    for (let [name, file] of files) body.append(name, file)
    return body
  }
  let noFile = () => new File([], '', { type: 'application/octet-stream' })

  it('the post form uploads files', async () => {
    let html = await (await adminFetch(routes.admin.posts.new.index.href())).text()
    assert.match(
      html,
      /<form method="post" action="\/admin\/posts\/new" enctype="multipart\/form-data"/,
    )
    assert.match(html, /<input [^>]*type="file" name="photo_upload"/)
    assert.match(html, /<input [^>]*name="photo_uploads" type="file"[^>]*multiple/)
  })

  it('uploads a new photos post’s files, which it’s published with', async () => {
    let id = 'uploadnew1'
    let response = await adminFetch(routes.admin.posts.new.action.href(), {
      method: 'POST',
      body: multipartForm(
        {
          id,
          type: 'photos',
          date: '2026-10-21T09:30',
          offset: '+05:30',
          caption: '',
          photo_file: '',
          photo_alt: 'First',
          photo_width: '',
          photo_height: '',
        },
        [
          ['photo_upload', new File(['one'], 'My Photo.jpg', { type: 'image/jpeg' })],
          ['photo_uploads', new File(['two'], 'two.png', { type: 'image/png' })],
          ['photo_uploads', new File(['three'], 'three.webp', { type: 'text/html' })],
          // Another type's fields are on the new post page too, but only the chosen type's count.
          ['video_upload', new File(['v'], 'clip.mp4', { type: 'video/mp4' })],
        ],
      ),
    })
    assert.equal(response.status, 303)
    let saved = await findPost(id)
    assert.deepEqual(saved?.type === 'photos' && saved.photos, [
      { src: `/posts/${id}/My-Photo.jpg`, alt: 'First' },
      { src: `/posts/${id}/two.png`, alt: '' },
      { src: `/posts/${id}/three.webp`, alt: '' },
    ])
    assert.equal(await hasPostFile(id, 'clip.mp4'), false)

    // Served with the type its name gives, not the one the browser claimed.
    let file = await fetch(`/posts/${id}/three.webp`)
    assert.equal(file.status, 200)
    assert.equal(file.headers.get('Content-Type'), 'image/webp')
    assert.equal(await file.text(), 'three')
  })

  it('an edit can replace a video and upload files for an article body', async () => {
    let video = await samplePost('video')
    let response = await adminFetch(routes.admin.posts.edit.action.href({ id: video.id }), {
      method: 'POST',
      body: multipartForm(
        { date: '2026-10-21T09:30', offset: '+05:30', video_file: 'flower.mp4' },
        [
          ['video_upload', new File(['new video'], 'garden.mp4')],
          ['video_poster_upload', noFile()],
        ],
      ),
    })
    assert.equal(response.status, 303)
    let saved = await findPost(video.id)
    assert.equal(saved?.type === 'video' && saved.video.src, `/posts/${video.id}/garden.mp4`)
    assert.equal(saved?.type === 'video' && saved.video.poster, undefined)

    let article = await samplePost('article')
    let edit = await adminFetch(routes.admin.posts.edit.action.href({ id: article.id }), {
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
    assert.equal(edit.status, 303)
    assert.equal(await hasPostFile(article.id, 'chart.png'), true)
    let page = await (
      await adminFetch(routes.admin.posts.edit.index.href({ id: article.id }))
    ).text()
    assert.match(
      page,
      new RegExp(`<a href="/posts/${article.id}/chart\\.png"><code>chart\\.png</code>`),
    )
  })

  it('rejects files that aren’t photos or videos, and keeps the ones that are', async () => {
    let id = 'uploadbad1'
    let response = await adminFetch(routes.admin.posts.new.action.href(), {
      method: 'POST',
      body: multipartForm(
        { id, type: 'video', date: '2026-10-21T09:30', offset: '+05:30', video_file: '' },
        [
          ['video_upload', new File(['v'], 'clip.mp4')],
          ['video_poster_upload', new File(['<svg/>'], 'poster.svg')],
        ],
      ),
    })
    let html = await response.text()
    assert.equal(response.status, 400)
    assert.match(html, /“poster\.svg” can’t be uploaded/)
    assert.equal(await findPost(id), undefined)
    assert.equal(await hasPostFile(id, 'poster.svg'), false)
    // The video was saved, so the form comes back naming it, and saving again publishes.
    assert.equal(await hasPostFile(id, 'clip.mp4'), true)
    assert.match(html, /<input [^>]*name="video_file"[^>]*value="clip\.mp4"/)
    assert.match(html, /<code>clip\.mp4<\/code>/)
  })

  it('doesn’t let a resubmitted new post form replace the published post’s files', async () => {
    let [post] = await getPosts()
    await savePostFile(post.id, 'same.jpg', new File(['original'], 'same.jpg'))
    let response = await adminFetch(routes.admin.posts.new.action.href(), {
      method: 'POST',
      body: multipartForm({ ...Object.fromEntries(textPostForm()), id: post.id }, [
        ['article_uploads', new File(['replaced'], 'same.jpg')],
      ]),
    })
    assert.equal(response.status, 400)
    let file = await fetch(`/posts/${post.id}/same.jpg`)
    assert.equal(await file.text(), 'original')
  })

  it('answers a form with too many files with a page saying so', async () => {
    let post = await samplePost('text')
    let files = Array.from({ length: 101 }, (): [string, File] => ['photo_upload', noFile()])
    let response = await adminFetch(routes.admin.posts.edit.action.href({ id: post.id }), {
      method: 'POST',
      body: multipartForm(Object.fromEntries(textPostForm({ caption: 'Too many' })), files),
    })
    assert.equal(response.status, 413)
    assert.match(await response.text(), /Upload too large/)
    assert.notEqual((await findPost(post.id))?.caption, 'Too many')
  })

  it('editing an unknown post is a 404', async () => {
    let response = await adminFetch(routes.admin.posts.edit.index.href({ id: 'nosuchpost' }))
    assert.equal(response.status, 404)
  })
})

function unescapeHtml(html: string) {
  return html
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
}
