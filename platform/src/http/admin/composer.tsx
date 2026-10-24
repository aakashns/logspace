// The composer at /admin/posts/new, where posts are written.
//
// As you write, the composer posts its form with Datastar (see views/admin/composer-controls.tsx), and
// HTML for parts of the page: its media when files are added or removed, and the preview as you
// type. Each of those requests sends the whole form, so each saves it as the draft, which the
// composer picks up again on any browser until the post is published or discarded. Posting it
// publishes; it's also a plain form, for a browser without Datastar.
//
// Every tab with the composer open also has a stream of updates (composerUpdates): the composer
// as the draft is now, sent whenever it changes. The tab that made a change already shows it (and
// may have more typed since), so each request says which tab it's from, and that tab isn't sent
// its own change.
import { Clock, Effect, Result, Schema, Stream } from 'effect'
import { HttpServerRequest, HttpServerResponse } from 'effect/http'

import type { Html } from '#jsx/jsx-runtime'
import type { PostRejected } from '../../commands/errors.ts'
import { PostCommands } from '../../commands/posts.ts'
import {
  composePost,
  composeTextValues,
  filesNoLongerUsed,
  readComposeForm,
  withArticleText,
  type ComposeValues,
  type DraftVersion,
} from '../../domain/compose.ts'
import { MAX_UPLOAD_FILE_SIZE, MAX_UPLOAD_TOTAL_SIZE } from '../../domain/constants.ts'
import { findArticleFiles } from '../../domain/markdown.ts'
import { dateAtOffset, offsetOf } from '../../domain/post-form.ts'
import { isPostId, newPostId, type PostIssue } from '../../domain/post.ts'
import { LinkPreviews } from '../../queries/link-previews.ts'
import { PostMedia } from '../../queries/post-media.ts'
import { PostQueries } from '../../queries/posts.ts'
import { SiteConfigQueries } from '../../queries/site-config.ts'
import { routes } from '../../routes.ts'
import { DraftChanges } from '../../services/draft-changes.ts'
import {
  COMPOSER_IDS,
  ComposePage,
  Composer,
  ComposerIssues,
  ComposerMedia,
  ComposerPreview,
  ComposerTools,
  DraftNote,
  type ComposerProps,
  type DraftState,
} from '../../views/admin/compose.tsx'
import { LOGIN_FORM_LIMIT, megabytes, readForm } from '../forms.ts'
import { param, requestUrl } from '../pages.ts'
import { fileResponse, notFound, redirect } from '../responses.ts'
import { adminPage, loggedIn } from './pages.tsx'

// The submitted composer, with the text of a Markdown file chosen for the article.
const readComposer = Effect.fnUntraced(function* (formData: FormData) {
  let form = readComposeForm(formData)
  let file = form.articleFile
  if (!file) return form
  let text = yield* Effect.promise(() => file.text())
  return withArticleText(form, file.name, text)
})

// The tab a composer's form was sent from.
const tabOf = (form: FormData) => {
  let tab = form.get('tab')
  return typeof tab === 'string' ? tab : undefined
}

// Whether Datastar sent the request, rather than the browser posting the form.
const fromDatastar = Effect.map(
  HttpServerRequest.HttpServerRequest,
  (request) => request.headers['datastar-request'] === 'true',
)

// What Datastar gets: parts of the composer to replace, by id, or to morph (`outer`), or the
// inside of one to morph (`inner`), as server-sent events.
type Patch = [id: string, html: Html, mode?: 'outer' | 'inner']

interface ComposerUpdate {
  id: string
  kind: 'stream' | 'preview' | 'media' | 'publish'
  version?: DraftVersion | undefined
  by?: string | undefined
  fields?: ReturnType<typeof composeTextValues> | undefined
  previousId?: string | undefined
  previousState?: 'active' | 'published' | 'retired' | undefined
}

const patchEvents = (update: ComposerUpdate, ...patches: Patch[]) =>
  patches
    .map(
      ([id, html, mode = 'replace']) =>
        `event: datastar-patch-elements\ndata: selector #${id}\ndata: mode ${mode}\n` +
        `data: composer ${JSON.stringify(update)}\n` +
        html.value
          .split(/\r\n?|\n/)
          .map((line) => `data: elements ${line}\n`)
          .join('') +
        '\n',
    )
    .join('')

const composerPatch = (update: ComposerUpdate, ...patches: Patch[]) =>
  HttpServerResponse.text(patchEvents(update, ...patches), { contentType: 'text/event-stream' })

// What the composer's note says once a command has saved the draft, or not.
const draftState = (result: Result.Result<DraftVersion | undefined, PostRejected>): DraftState =>
  Result.isFailure(result) ? 'refused' : result.success ? 'saved' : undefined

// The composer for `values`, with its post as it'd be published now.
const composerProps = (values: ComposeValues, issues?: readonly PostIssue[], draft?: DraftState) =>
  Effect.gen(function* () {
    let now = yield* Clock.currentTimeMillis
    let queries = yield* PostQueries
    let post = yield* queries.preview(composePost(values, dateAtOffset(now, values.offset)))
    let { siteUrl = '' } = yield* (yield* SiteConfigQueries).saved
    let linkPreview = yield* (yield* LinkPreviews).forPost(post)
    if (post.type !== 'article') {
      return { values, post, linkPreview, siteUrl, issues, draft } satisfies ComposerProps
    }
    let articleHtml = yield* queries.articleHtml(post, { drafts: true })
    let uploaded = new Set((yield* queries.files(post.id)).map((file) => file.name))
    let articleFiles = findArticleFiles(post.id, post.article.body).map((name) => ({
      name,
      uploaded: uploaded.has(name),
    }))
    return {
      values,
      post,
      linkPreview,
      articleHtml,
      articleFiles,
      siteUrl,
      issues,
      draft,
    } satisfies ComposerProps
  })

// The draft, if there's one, with its id, so its files are its own again. Otherwise a new post,
// at the newest post's UTC offset. Either way, the browser's own offset replaces it on load.
const currentComposer = (preferredId?: string) =>
  Effect.gen(function* () {
    let queries = yield* PostQueries
    let draft = yield* queries.draft
    if (draft) return yield* composerProps(draft, undefined, 'saved')
    let [newest] = yield* queries.all
    return yield* composerProps({
      id: preferredId ?? newPostId(),
      caption: '',
      city: '',
      offset: offsetOf(newest?.date),
      photos: [],
    })
  })

// A new tab of the composer, with its own id.
export const compose = loggedIn(() =>
  Effect.gen(function* () {
    let props = yield* currentComposer()
    return yield* adminPage('New Post', <ComposePage {...props} tab={crypto.randomUUID()} />)
  }),
)

// Bun closes a connection after 255 seconds without a byte (see cli/start.ts), so an idle stream
// sends a comment, which browsers ignore, more often than that.
const KEEP_ALIVE = '30 seconds'

// The stream of the composer for one tab: the draft as it is when the stream opens, and again
// whenever it changes, unless the change was the tab's own. The first snapshot always reconciles
// the connection: its latest write may have committed without its response reaching the tab.
// Changes that come faster than they're sent are sent once, as the draft is by then.
export const composerUpdates = loggedIn(() =>
  Effect.gen(function* () {
    let params = (yield* requestUrl).searchParams
    let tab = params.get('tab') ?? ''
    let signals = Schema.decodeUnknownResult(
      Schema.fromJsonString(Schema.Struct({ _postId: Schema.optional(Schema.String) })),
    )(params.get('datastar') ?? '{}')
    let requestedId = Result.isSuccess(signals) ? signals.success._postId : undefined
    let previousId = requestedId && isPostId(requestedId) ? requestedId : undefined
    let queries = yield* PostQueries
    let first = true
    let composers = (yield* DraftChanges).latest.pipe(
      Stream.buffer({ capacity: 1, strategy: 'sliding' }),
      Stream.filter((change) => {
        let initial = first
        first = false
        return initial || change.by !== tab
      }),
      Stream.mapEffect(({ by, ...version }) =>
        Effect.gen(function* () {
          let previousState = previousId ? yield* queries.composerState(previousId) : undefined
          let props = yield* currentComposer(previousState === 'active' ? previousId : undefined)
          return patchEvents(
            {
              id: props.values.id,
              kind: 'stream',
              version,
              by,
              fields: composeTextValues(props.values),
              previousId,
              previousState,
            },
            [COMPOSER_IDS.composer, <Composer {...props} tab={tab} />, 'outer'],
          )
        }),
      ),
    )
    let services = yield* Effect.context<Stream.Services<typeof composers>>()
    let events = Stream.merge(
      Stream.provideContext(composers, services),
      Stream.tick(KEEP_ALIVE).pipe(Stream.as(': keep-alive\n\n')),
      // It ends as the server stops (see cli/start.ts).
      { haltStrategy: 'left' },
    )
    return HttpServerResponse.stream(Stream.encodeText(events), {
      contentType: 'text/event-stream',
    })
  }),
)

// The composer's media and toolbar, re-rendered, and what's wrong (or nothing).
const mediaPatch = (props: ComposerProps, kind: 'media' | 'publish', version?: DraftVersion) =>
  composerPatch(
    { id: props.values.id, kind, version },
    [COMPOSER_IDS.issues, <ComposerIssues issues={props.issues} refresh />],
    [COMPOSER_IDS.media, <ComposerMedia {...props} />],
    [COMPOSER_IDS.tools, <ComposerTools values={props.values} />],
    [COMPOSER_IDS.draft, <DraftNote state={props.draft} values={props.values} />],
  )

// Files chosen are saved right away, and the media is shown with them; files taken out are
// deleted, and the draft is saved. Files too big to send at all are dropped from the form, with a
// note saying why.
export const updateComposerMedia = loggedIn(() =>
  Effect.gen(function* () {
    let formData = yield* readForm()
    let form = yield* readComposer(formData)
    let { values, uploads, issues } = form
    let commands = yield* PostCommands
    let result = yield* Effect.result(
      commands.updateFiles(values, uploads, filesNoLongerUsed(form), tabOf(formData)),
    )
    let rejected = Result.isFailure(result) ? result.failure.issues : []
    if (rejected.length > 0) {
      let unsaved = new Set(uploads.map((upload) => upload.name))
      let saved = (file: string | undefined) => (file && unsaved.has(file) ? undefined : file)
      values = {
        ...values,
        photos: values.photos.filter((file) => !unsaved.has(file)),
        video: saved(values.video),
        poster: saved(values.poster),
        cover: saved(values.cover),
      }
    }
    return mediaPatch(
      yield* composerProps(values, [...issues, ...rejected], draftState(result)),
      'media',
      Result.isSuccess(result) ? result.success : undefined,
    )
  }).pipe(
    Effect.catchTag('UploadTooLarge', () =>
      Effect.succeed(
        composerPatch({ id: '', kind: 'media' }, [
          COMPOSER_IDS.issues,
          <ComposerIssues issues={[{ message: COMPOSER_TOO_LARGE }]} clearFiles />,
        ]),
      ),
    ),
  ),
)

const COMPOSER_TOO_LARGE =
  `That’s too big to upload: files can be up to ${megabytes(MAX_UPLOAD_FILE_SIZE)} each, and ` +
  `${megabytes(MAX_UPLOAD_TOTAL_SIZE)} at once. Choose fewer or smaller files.`

// The preview, for what's typed, which is saved as the draft. Files chosen but not yet uploaded
// aren't in either.
export const previewComposer = loggedIn(() =>
  Effect.gen(function* () {
    let form = yield* readForm()
    // Collected first, since deleting while iterating the form would skip entries.
    let files: string[] = []
    form.forEach((value, name) => typeof value !== 'string' && files.push(name))
    for (let name of files) form.delete(name)
    let { values } = readComposeForm(form)
    let result = yield* Effect.result((yield* PostCommands).saveDraft(values, tabOf(form)))
    let draft = draftState(result)
    return composerPatch(
      {
        id: values.id,
        kind: 'preview',
        version: Result.isSuccess(result) ? result.success : undefined,
      },
      [COMPOSER_IDS.preview, <ComposerPreview {...yield* composerProps(values)} />, 'inner'],
      [COMPOSER_IDS.draft, <DraftNote state={draft} values={values} />],
    )
  }),
)

// Dated now. Datastar is sent to the post once it's published, or shown what's wrong.
export const publishComposer = loggedIn(() =>
  Effect.gen(function* () {
    let datastar = yield* fromDatastar
    let form = yield* readForm()
    let tab = tabOf(form)
    let { values, uploads, issues } = yield* readComposer(form)
    let rejectedWith = (issues: readonly PostIssue[]) =>
      Effect.flatMap(composerProps(values, issues), (props) =>
        datastar
          ? Effect.succeed(mediaPatch(props, 'publish'))
          : // A new page, so a new tab.
            adminPage('New Post', <ComposePage {...props} tab={crypto.randomUUID()} />, {
              status: 400,
            }),
      )
    let post = composePost(values, dateAtOffset(yield* Clock.currentTimeMillis, values.offset))
    if (post.type === 'text' && post.caption === '' && issues.length === 0) {
      return yield* rejectedWith([
        { message: 'Write something, or add photos, a video, or an article.' },
      ])
    }
    return yield* (yield* PostCommands).publish({ post, uploads, issues }, tab).pipe(
      Effect.map((published) =>
        datastar
          ? composerPatch({ id: values.id, kind: 'publish' }, [
              COMPOSER_IDS.issues,
              <ComposerIssues redirect={routes.post(published.id)} />,
            ])
          : redirect(routes.post(published.id), 303),
      ),
      Effect.catchTag('PostRejected', (rejected) => rejectedWith(rejected.issues)),
    )
  }),
)

// Deletes what was uploaded for a post that won't be published, and its draft, and starts a new
// one.
export const discardComposer = loggedIn(() =>
  Effect.gen(function* () {
    let form = yield* readForm(LOGIN_FORM_LIMIT)
    let id = form.get('post_id') ?? form.get('id')
    return yield* (yield* PostCommands).discard(typeof id === 'string' ? id : '').pipe(
      Effect.catchTag('PostRejected', () => Effect.void),
      Effect.as(redirect(routes.admin.newPost(), 303)),
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
        ? yield* media.resized(id, name, Number(width), version, { drafts: true })
        : yield* media.original(id, name, { drafts: true })
    return file ? yield* fileResponse(file, 'no-store') : notFound()
  }),
)
