// The composer, where posts are written, at /admin/posts/new, and edited, at /admin/posts/<id>/edit;
// and deleting posts.
//
// The composer works the same for both: the page holds the post, by its id, and nothing about it
// is saved until it's posted. As you write, Datastar posts the form, and gets HTML for parts of
// the page: the media when files are added or removed, and the preview as you type. Files chosen
// are saved under the post's id right away, with names of their own, so a published post's files
// don't change until it's saved. Posting is a plain form submission, which saves the post, new or
// published, and goes to it.
import { DateTime, Effect } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/http'

import type { Html } from '#jsx/jsx-runtime'
import { LinkPreviews } from '../../../data/link-previews/link-previews.ts'
import { PostCommands } from '../../../data/posts/commands.ts'
import { PostMedia } from '../../../data/posts/media.ts'
import { newPostId, type PostIssue, type PostRecord } from '../../../data/posts/post.ts'
import { PostQueries } from '../../../data/posts/queries.ts'
import { SiteConfigQueries } from '../../../data/site/queries.ts'
import {
  MAX_UPLOAD_FILE_SIZE,
  MAX_UPLOAD_TOTAL_SIZE,
  megabytes,
  readForm,
} from '../../../lib/http/forms.ts'
import { param, requestUrl } from '../../../lib/http/pages.ts'
import { fileResponse, notFound, redirect } from '../../../lib/http/responses.ts'
import { urls } from '../../../lib/urls.ts'
import { adminOnly, adminPage, message } from '../admin.tsx'
import { composePost, composeValues, readComposeForm, type ComposeValues } from './form.ts'
import {
  COMPOSE_PAGE_STYLES,
  COMPOSER_IDS,
  ComposePage,
  ComposerIssues,
  ComposerMedia,
  ComposerPreview,
  ComposerTools,
} from './page.tsx'

const postNotFound = message(
  'Post not found',
  <>
    There’s no post with this id. <a href={urls.admin.posts()}>See all posts</a>
  </>,
  404,
)

// Parts of the composer for Datastar to replace, by id, or with `inner`, to morph the inside of,
// as server-sent events.
const patch = (...patches: [id: string, html: Html, mode?: 'inner'][]) =>
  HttpServerResponse.text(
    patches
      .map(
        ([id, html, mode = 'replace']) =>
          `event: datastar-patch-elements\ndata: selector #${id}\ndata: mode ${mode}\n` +
          html.value
            .split(/\r\n?|\n/)
            .map((line) => `data: elements ${line}\n`)
            .join('') +
          '\n',
      )
      .join(''),
    { contentType: 'text/event-stream' },
  )

// A submitted composer, and its post as it's published, if it is.
const readComposer = Effect.gen(function* () {
  let formData = yield* readForm()
  let id = String(formData.get('post_id') ?? '').trim()
  let posts = yield* PostQueries
  let published = yield* posts.findRecord(id)
  return { ...readComposeForm(formData, id, yield* posts.fileNames(id)), published }
})

// The post the composer makes: published now, in UTC, to the second, or an edit.
const composed = (values: ComposeValues, published: PostRecord | undefined) =>
  Effect.map(DateTime.now, (now) =>
    composePost(values, DateTime.formatIso(now).slice(0, 19) + 'Z', published),
  )

// The composer for `values`, with its post as it'd be saved now.
const composerProps = (
  values: ComposeValues,
  published: PostRecord | undefined,
  issues?: readonly PostIssue[],
) =>
  Effect.gen(function* () {
    let post = yield* (yield* PostQueries).preview(yield* composed(values, published))
    let { siteUrl = '' } = yield* (yield* SiteConfigQueries).saved
    let linkPreview = yield* (yield* LinkPreviews).forPost(post)
    return { values, post, linkPreview, siteUrl, issues, published: published !== undefined }
  })

const composePage = (
  values: ComposeValues,
  published: PostRecord | undefined,
  issues?: readonly PostIssue[],
) =>
  Effect.flatMap(composerProps(values, published, issues), (props) =>
    adminPage(published ? 'Edit Post' : 'New Post', <ComposePage {...props} />, {
      styles: COMPOSE_PAGE_STYLES,
      status: issues ? 400 : 200,
    }),
  )

const compose = adminOnly(() =>
  composePage({ id: newPostId(), caption: '', photos: [] }, undefined),
)

const editPost = adminOnly(() =>
  Effect.gen(function* () {
    let published = yield* (yield* PostQueries).findRecord(yield* param('id'))
    if (!published) return yield* postNotFound
    return yield* composePage(composeValues(published), published)
  }),
)

// Files chosen are saved right away, and the media and preview are shown with them. The toolbar
// is sent again too, so its file inputs start empty. A file taken out is only left out of the
// form: saving the post removes it, and so does closing the composer (discardComposer).
const updateComposerMedia = adminOnly(() =>
  Effect.gen(function* () {
    let { values, uploads, issues, published } = yield* readComposer
    let rejected = yield* (yield* PostCommands).upload(values.id, uploads).pipe(
      Effect.as([]),
      Effect.catchTag('PostRejected', (error) => Effect.succeed(error.issues)),
    )
    if (rejected.length > 0) {
      let unsaved = new Set(uploads.map((upload) => upload.name))
      let saved = (file: string | undefined) => (file && unsaved.has(file) ? undefined : file)
      values = {
        ...values,
        photos: values.photos.filter((file) => !unsaved.has(file)),
        video: saved(values.video),
        poster: saved(values.poster),
      }
    }
    let props = yield* composerProps(values, published, [...issues, ...rejected])
    return patch(
      [COMPOSER_IDS.issues, <ComposerIssues issues={props.issues} />],
      [COMPOSER_IDS.media, <ComposerMedia {...props} />],
      [COMPOSER_IDS.tools, <ComposerTools />],
      [COMPOSER_IDS.preview, <ComposerPreview {...props} />, 'inner'],
    )
  }).pipe(
    Effect.catchTag('UploadTooLarge', () =>
      Effect.succeed(
        patch(
          [COMPOSER_IDS.issues, <ComposerIssues issues={[{ message: COMPOSER_TOO_LARGE }]} />],
          [COMPOSER_IDS.tools, <ComposerTools />],
        ),
      ),
    ),
  ),
)

const COMPOSER_TOO_LARGE =
  `That’s too big to upload: files can be up to ${megabytes(MAX_UPLOAD_FILE_SIZE)} each, and ` +
  `${megabytes(MAX_UPLOAD_TOTAL_SIZE)} at once. Choose fewer or smaller files.`

// The preview, for what's typed. The composer doesn't ask for one while files are uploading.
const previewComposer = adminOnly(() =>
  Effect.gen(function* () {
    let { values, published } = yield* readComposer
    return patch([
      COMPOSER_IDS.preview,
      <ComposerPreview {...yield* composerProps(values, published)} />,
      'inner',
    ])
  }),
)

// Then the browser goes to the post, or it's shown what's wrong. A post with nothing in it isn't
// saved, unless files chosen with it were refused, which the composer says instead. A new post's
// form posted twice saves the same post again.
const saveComposer = adminOnly(() =>
  Effect.gen(function* () {
    let { values, uploads, issues, published } = yield* readComposer
    let post = yield* composed(values, published)
    if (post.type === 'text' && post.caption === '' && issues.length === 0) {
      let empty = [{ message: 'Write something, or add photos or a video.' }]
      return yield* composePage(values, published, empty)
    }
    return yield* (yield* PostCommands).save({ post, uploads, issues }).pipe(
      Effect.as(redirect(urls.post(values.id), 303)),
      Effect.catchTag('PostRejected', (rejected) =>
        composePage(values, published, rejected.issues),
      ),
    )
  }),
)

// The composer's ×: what it uploaded goes, and the browser goes back to the list of posts. A tab
// closed instead leaves its uploads in storage, unserved.
const discardComposer = adminOnly(() =>
  Effect.gen(function* () {
    let id = (yield* readForm()).get('post_id')
    yield* (yield* PostCommands).discard(typeof id === 'string' ? id.trim() : '')
    return redirect(urls.admin.posts(), 303)
  }),
)

const deletePost = adminOnly(() =>
  Effect.gen(function* () {
    return yield* (yield* PostCommands).delete(yield* param('id')).pipe(
      Effect.as(redirect(urls.admin.posts(), 303)),
      Effect.catchTag('PostNotFound', () => postNotFound),
    )
  }),
)

// A post's file for the composer, whether it's published or not.
const postFile = adminOnly(() =>
  Effect.gen(function* () {
    let id = yield* param('id')
    let name = yield* param('file')
    let { searchParams } = yield* requestUrl
    let version = searchParams.get('v')
    let width = searchParams.get('w')
    let media = yield* PostMedia
    let file =
      version !== null && width !== null
        ? yield* media.resized(id, name, Number(width), version, { unpublished: true })
        : yield* media.original(id, name, { unpublished: true })
    return file ? yield* fileResponse(file, 'no-store') : notFound()
  }),
)

export const ComposeRoutes = HttpRouter.addAll([
  HttpRouter.route('GET', '/admin/posts/new', compose),
  HttpRouter.route('GET', '/admin/posts/:id/edit', editPost),
  HttpRouter.route('POST', '/admin/posts', saveComposer),
  HttpRouter.route('POST', '/admin/posts/discard', discardComposer),
  HttpRouter.route('POST', '/admin/posts/media', updateComposerMedia),
  HttpRouter.route('POST', '/admin/posts/preview', previewComposer),
  HttpRouter.route('GET', '/admin/posts/:id/files/:file', postFile),
  HttpRouter.route('POST', '/admin/posts/:id/delete', deletePost),
])
