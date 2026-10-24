// The composer at /admin/posts/new, where posts are written.
//
// Nothing about the post is kept on the server until it's posted: the page holds it. As you
// write, Datastar posts the form, and gets HTML for parts of the page: the media when files are
// added or removed (the files are saved under the post's id right away), and the preview as you
// type. Posting is a plain form submission, which publishes the post and goes to it.
import { Clock, Effect } from 'effect'
import { HttpServerResponse } from 'effect/http'

import type { Html } from '#jsx/jsx-runtime'
import { PostCommands } from '../../commands/posts.ts'
import { composePost, readComposeForm, type ComposeValues } from '../../domain/compose.ts'
import { MAX_UPLOAD_FILE_SIZE, MAX_UPLOAD_TOTAL_SIZE } from '../../domain/constants.ts'
import { dateAtOffset, offsetOf } from '../../domain/post-form.ts'
import { newPostId, type PostIssue } from '../../domain/post.ts'
import { LinkPreviews } from '../../queries/link-previews.ts'
import { PostMedia } from '../../queries/post-media.ts'
import { PostQueries } from '../../queries/posts.ts'
import { SiteConfigQueries } from '../../queries/site-config.ts'
import { routes } from '../../routes.ts'
import {
  COMPOSER_IDS,
  ComposePage,
  ComposerIssues,
  ComposerMedia,
  ComposerPreview,
  ComposerTools,
} from '../../views/admin/compose.tsx'
import { megabytes, readForm } from '../forms.ts'
import { param, requestUrl } from '../pages.ts'
import { fileResponse, notFound, redirect } from '../responses.ts'
import { adminPage, loggedIn } from './pages.tsx'

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

// Now, at the newest post's UTC offset, since the server can't know the browser's. The post's
// edit page can change it.
const newPostDate = Effect.gen(function* () {
  let [newest] = yield* (yield* PostQueries).all
  return dateAtOffset(yield* Clock.currentTimeMillis, offsetOf(newest?.date))
})

// The composer for `values`, with its post as it'd be published now.
const composerProps = (values: ComposeValues, issues?: readonly PostIssue[]) =>
  Effect.gen(function* () {
    let record = composePost(values, yield* newPostDate)
    let post = yield* (yield* PostQueries).preview(record)
    let { siteUrl = '' } = yield* (yield* SiteConfigQueries).saved
    let linkPreview = yield* (yield* LinkPreviews).forPost(post)
    return { values, post, linkPreview, siteUrl, issues }
  })

const composePage = (values: ComposeValues, issues?: readonly PostIssue[]) =>
  Effect.flatMap(composerProps(values, issues), (props) =>
    adminPage('New Post', <ComposePage {...props} />, { status: issues ? 400 : 200 }),
  )

export const compose = loggedIn(() => composePage({ id: newPostId(), caption: '', photos: [] }))

// Files chosen are saved right away, and the media and preview are shown with them. The toolbar
// is sent again too, so its file inputs start empty. A file taken out is left in storage,
// unserved, as is everything uploaded for a post that's never posted.
export const updateComposerMedia = loggedIn(() =>
  Effect.gen(function* () {
    let { values, uploads, issues } = readComposeForm(yield* readForm())
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
    let props = yield* composerProps(values, [...issues, ...rejected])
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
export const previewComposer = loggedIn(() =>
  Effect.gen(function* () {
    let { values } = readComposeForm(yield* readForm())
    return patch([
      COMPOSER_IDS.preview,
      <ComposerPreview {...yield* composerProps(values)} />,
      'inner',
    ])
  }),
)

// Then the browser goes to the post, or it's shown what's wrong. A form posted twice goes to the
// post the first published.
export const publishComposer = loggedIn(() =>
  Effect.gen(function* () {
    let { values, uploads, issues } = readComposeForm(yield* readForm())
    let post = composePost(values, yield* newPostDate)
    if (post.type === 'text' && post.caption === '' && issues.length === 0) {
      return yield* composePage(values, [{ message: 'Write something, or add photos or a video.' }])
    }
    return yield* (yield* PostCommands).publish({ post, uploads, issues }).pipe(
      Effect.as(redirect(routes.post(values.id), 303)),
      Effect.catchTag('PostRejected', (rejected) =>
        Effect.flatMap(PostQueries, (queries) => queries.findRecord(values.id)).pipe(
          Effect.flatMap((published) =>
            published
              ? Effect.succeed(redirect(routes.post(values.id), 303))
              : composePage(values, rejected.issues),
          ),
        ),
      ),
    )
  }),
)

// A post's file for the composer, whether it's published or not.
export const postFile = loggedIn(() =>
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
