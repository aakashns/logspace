// The pages under /admin, for managing the site: logging in and out, the list of posts, the
// site's settings, and writing, editing, and deleting posts. Every handler here only reads and
// sends commands; what a command does is in commands/.
import { Clock, Effect, Result } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'

import type { Child, Html } from '#jsx/jsx-runtime'
import type { PostRejected } from '../commands/errors.ts'
import { PostCommands } from '../commands/posts.ts'
import { SiteConfigCommands } from '../commands/site-config.ts'
import {
  composePost,
  filesNoLongerUsed,
  readComposeForm,
  withArticleText,
  type ComposeValues,
} from '../domain/compose.ts'
import { MAX_UPLOAD_FILE_SIZE, MAX_UPLOAD_TOTAL_SIZE } from '../domain/constants.ts'
import { findArticleFiles } from '../domain/markdown.ts'
import { dateAtOffset, offsetOf, readPostForm, type PostFormValues } from '../domain/post-form.ts'
import { newPostId, type PostIssue } from '../domain/post.ts'
import {
  isSiteConfigured,
  SITE_IMAGE_KINDS,
  type SiteConfigIssue,
  type SiteImageKind,
  type SiteText,
} from '../domain/site.ts'
import { LinkPreviews } from '../queries/link-previews.ts'
import { PostMedia } from '../queries/post-media.ts'
import { PostQueries } from '../queries/posts.ts'
import { SiteConfigQueries } from '../queries/site-config.ts'
import { routes } from '../routes.ts'
import {
  COMPOSER_IDS,
  ComposePage,
  ComposerIssues,
  ComposerMedia,
  ComposerPreview,
  ComposerTools,
  DraftNote,
  type ComposerProps,
  type DraftState,
} from '../views/admin/compose.tsx'
import { AdminMessage, AdminPage } from '../views/admin/page.tsx'
import { ConfigPage } from '../views/admin/config.tsx'
import { LoginPage } from '../views/admin/login.tsx'
import { PostForm } from '../views/admin/post-form.tsx'
import { PostsPage } from '../views/admin/posts.tsx'
import {
  LOGIN_FORM_LIMIT,
  MalformedForm,
  megabytes,
  readForm,
  UPLOAD_TOO_LARGE_MESSAGE,
  UploadTooLarge,
} from './forms.ts'
import { pageContext, pageResponse, param, requestUrl } from './pages.ts'
import { fileResponse, notFound, redirect, textResponse } from './responses.ts'
import { AdminAuth, type Session } from './session.ts'

// An admin page's response.
const adminPage = (
  title: string,
  content: Child,
  options?: { status?: number | undefined; loggedIn?: boolean | undefined },
) =>
  Effect.gen(function* () {
    let page = yield* pageContext
    let { pathname } = yield* requestUrl
    return pageResponse(
      page,
      <AdminPage page={page} path={pathname} title={title} loggedIn={options?.loggedIn}>
        {content}
      </AdminPage>,
      options,
    )
  })

const message = (title: string, text: Child, status: number) =>
  adminPage(title, <AdminMessage title={title}>{text}</AdminMessage>, { status })

const postNotFound = message(
  'Post not found',
  <>
    There’s no post with this id. <a href={routes.admin.index()}>See all posts</a>
  </>,
  404,
)

// Keeps these pages out of caches and search results.
const privately = (response: HttpServerResponse.HttpServerResponse) =>
  HttpServerResponse.setHeaders(response, {
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex',
  })

// An admin page that needs a login: anyone else is sent to the login page, before a byte of what
// they sent is read. A form over the upload limits gets a page saying so.
const loggedIn = <R,>(
  handler: (
    session: Session,
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse, UploadTooLarge | MalformedForm, R>,
) =>
  Effect.gen(function* () {
    let auth = yield* AdminAuth
    return yield* Effect.flatMap(auth.requireLogin, handler)
  }).pipe(
    Effect.catchTags({
      // An old session's cookies go, so pages stop showing the link to the composer.
      NotLoggedIn: () =>
        Effect.map(AdminAuth, (auth) =>
          auth.saveSession(redirect(routes.admin.login()), undefined),
        ),
      UploadTooLarge: () => message('Upload too large', UPLOAD_TOO_LARGE_MESSAGE, 413),
      MalformedForm: () => Effect.succeed(textResponse('Bad Request', 400)),
    }),
    Effect.map(privately),
  )

// ---- Logging in and out

const loginPage = (error?: string) =>
  Effect.gen(function* () {
    let { enabled } = yield* AdminAuth
    return yield* adminPage('Log in', <LoginPage enabled={enabled} error={error} />, {
      status: error ? 401 : 200,
      loggedIn: false,
    })
  })

const showLogin = Effect.gen(function* () {
  let auth = yield* AdminAuth
  let loggedIn = yield* Effect.isSuccess(auth.requireLogin)
  return privately(loggedIn ? redirect(routes.admin.index()) : yield* loginPage())
})

// Anyone can send this form, so it's read only up to a few kilobytes.
const logIn = Effect.gen(function* () {
  let auth = yield* AdminAuth
  let form = yield* readForm(LOGIN_FORM_LIMIT)
  if (!auth.checkPassword(form.get('password'))) {
    return yield* loginPage('That password isn’t right.')
  }
  return auth.saveSession(redirect(routes.admin.index()), auth.logIn())
}).pipe(
  Effect.catchTags({
    UploadTooLarge: () => message('Upload too large', UPLOAD_TOO_LARGE_MESSAGE, 413),
    MalformedForm: () => loginPage('That password isn’t right.'),
  }),
  Effect.map(privately),
)

const logOut = Effect.gen(function* () {
  let auth = yield* AdminAuth
  return privately(auth.saveSession(redirect(routes.admin.login()), undefined))
})

// ---- The list of posts

const index = loggedIn(() =>
  Effect.gen(function* () {
    // The site's required settings come first.
    if (!isSiteConfigured(yield* (yield* SiteConfigQueries).saved)) {
      return redirect(routes.admin.config())
    }
    let posts = yield* (yield* PostQueries).all
    return yield* adminPage('Manage Site', <PostsPage posts={posts} />)
  }),
)

// ---- The site's settings

const configPage = (props: {
  values: SiteText
  issues?: readonly SiteConfigIssue[] | undefined
  saved?: boolean | undefined
}) =>
  Effect.gen(function* () {
    let saved = yield* (yield* SiteConfigQueries).saved
    return yield* adminPage(
      'Configure Site',
      <ConfigPage {...props} images={saved} unconfigured={!isSiteConfigured(saved)} />,
      { status: props.issues ? 400 : 200 },
    )
  })

const showConfig = loggedIn((session) =>
  Effect.gen(function* () {
    let auth = yield* AdminAuth
    let saved = yield* (yield* SiteConfigQueries).saved
    let values: SiteText = {
      siteTitle: saved.siteTitle ?? '',
      // Most likely where the site is being set up. Behind the proxy (TRUST_PROXY), the
      // request's origin is the public one.
      siteUrl: saved.siteUrl ?? (yield* requestUrl).origin,
      siteDescription: saved.siteDescription ?? '',
      heroHeading: saved.heroHeading,
      heroSubheading: saved.heroSubheading,
      bannerImageAlt: saved.bannerImageAlt,
    }
    let response = yield* configPage({ values, saved: session.flash === 'configSaved' })
    // The note that the settings were saved is shown once.
    let { flash, ...read } = session
    return flash ? auth.saveSession(response, read) : response
  }),
)

const saveConfig = loggedIn((session) =>
  Effect.gen(function* () {
    let form = yield* readForm()
    let values = readConfigForm(form)
    let uploads: Partial<Record<SiteImageKind, File>> = {}
    let removals: SiteImageKind[] = []
    for (let kind of SITE_IMAGE_KINDS) {
      let upload = form.get(kind)
      // A file input left empty sends an empty file.
      if (typeof upload !== 'string' && upload !== null && upload.size > 0) uploads[kind] = upload
      else if (form.get(`${kind}Remove`) !== null) removals.push(kind)
    }
    return yield* (yield* SiteConfigCommands).update(values, uploads, removals).pipe(
      Effect.flatMap(() =>
        Effect.map(AdminAuth, (auth) =>
          auth.saveSession(redirect(routes.admin.config(), 303), {
            ...session,
            flash: 'configSaved',
          }),
        ),
      ),
      Effect.catchTag('SiteConfigRejected', (rejected) =>
        configPage({ values, issues: rejected.issues }),
      ),
    )
  }),
)

// The submitted settings, trimmed, with line breaks (which browsers send as \r\n from a
// textarea) turned into spaces, since every setting is shown on one line. The site URL loses a
// trailing slash.
function readConfigForm(form: FormData): SiteText {
  let text = (name: keyof SiteText) => {
    let value = form.get(name)
    return typeof value === 'string' ? value.replace(/\s*[\r\n]+\s*/g, ' ').trim() : ''
  }
  return {
    siteTitle: text('siteTitle'),
    siteUrl: text('siteUrl').replace(/\/+$/, ''),
    siteDescription: text('siteDescription'),
    heroHeading: text('heroHeading'),
    heroSubheading: text('heroSubheading'),
    bannerImageAlt: text('bannerImageAlt'),
  }
}

// ---- Posts

// The edit page. New posts are written in the composer, below.
const postForm = (props: { values: PostFormValues; issues?: readonly PostIssue[] | undefined }) =>
  Effect.gen(function* () {
    let files = yield* (yield* PostQueries).files(props.values.id)
    return yield* adminPage('Edit Post', <PostForm {...props} files={files} />, {
      status: props.issues ? 400 : 200,
    })
  })

const editPost = loggedIn(() =>
  Effect.gen(function* () {
    let values = yield* (yield* PostQueries).findRecord(yield* param('id'))
    if (!values) return yield* postNotFound
    return yield* postForm({ values })
  }),
)

const savePost = loggedIn(() =>
  Effect.gen(function* () {
    let id = yield* param('id')
    let existing = yield* (yield* PostQueries).findRecord(id)
    if (!existing) return yield* postNotFound
    let form = readPostForm(yield* readForm(), id, existing.type)
    return yield* (yield* PostCommands).edit(id, form).pipe(
      Effect.map(() => redirect(routes.post(id), 303)),
      Effect.catchTags({
        PostNotFound: () => postNotFound,
        PostRejected: (rejected) => postForm({ values: form.post, issues: rejected.issues }),
      }),
    )
  }),
)

const deletePost = loggedIn(() =>
  Effect.gen(function* () {
    return yield* (yield* PostCommands).delete(yield* param('id')).pipe(
      Effect.as(redirect(routes.admin.index(), 303)),
      Effect.catchTag('PostNotFound', () => postNotFound),
    )
  }),
)

// ---- The composer, where posts are written
//
// As you write, the composer posts its form with Datastar (see views/controls.tsx), and gets back
// HTML for parts of the page: its media when files are added or removed, and the preview as you
// type. Each of those requests sends the whole form, so each saves it as the draft, which the
// composer picks up again on any browser until the post is published or discarded. Posting it
// publishes; it's also a plain form, for a browser without Datastar.

// The submitted composer, with the text of a Markdown file chosen for the article.
const readComposer = Effect.fnUntraced(function* (formData: FormData) {
  let form = readComposeForm(formData)
  let file = form.articleFile
  if (!file) return form
  let text = yield* Effect.promise(() => file.text())
  return withArticleText(form, file.name, text)
})

// Whether Datastar sent the request, rather than the browser posting the form.
const fromDatastar = Effect.map(
  HttpServerRequest.HttpServerRequest,
  (request) => request.headers['datastar-request'] === 'true',
)

// What Datastar gets: parts of the composer to replace, by id, or the inside of one to morph
// (`inner`), as server-sent events.
function composerPatch(...patches: [id: string, html: Html, mode?: 'inner'][]) {
  let body = patches
    .map(
      ([id, html, mode = 'replace']) =>
        `event: datastar-patch-elements\ndata: selector #${id}\ndata: mode ${mode}\n` +
        html.value
          .split(/\r\n?|\n/)
          .map((line) => `data: elements ${line}\n`)
          .join('') +
        '\n',
    )
    .join('')
  return HttpServerResponse.text(body, { contentType: 'text/event-stream' })
}

// What the composer's note says once a command has saved the draft, or not.
const draftState = (result: Result.Result<boolean, PostRejected>): DraftState =>
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
const compose = loggedIn(() =>
  Effect.gen(function* () {
    let queries = yield* PostQueries
    let draft = yield* queries.draft
    if (draft) {
      let props = yield* composerProps(draft, undefined, 'saved')
      return yield* adminPage('New Post', <ComposePage {...props} />)
    }
    let [newest] = yield* queries.all
    let values: ComposeValues = {
      id: newPostId(),
      caption: '',
      city: '',
      offset: offsetOf(newest?.date),
      photos: [],
    }
    return yield* adminPage('New Post', <ComposePage {...yield* composerProps(values)} />)
  }),
)

// The composer's media and toolbar, re-rendered, and what's wrong (or nothing).
const mediaPatch = (props: ComposerProps) =>
  composerPatch(
    [COMPOSER_IDS.issues, <ComposerIssues issues={props.issues} />],
    [COMPOSER_IDS.media, <ComposerMedia {...props} />],
    [COMPOSER_IDS.tools, <ComposerTools values={props.values} />],
    [COMPOSER_IDS.draft, <DraftNote state={props.draft} />],
  )

// Files chosen are saved right away, and the media is shown with them; files taken out are
// deleted, and the draft is saved. Files too big to send at all are dropped from the form, with a
// note saying why.
const updateComposerMedia = loggedIn(() =>
  Effect.gen(function* () {
    let form = yield* readComposer(yield* readForm())
    let { values, uploads, issues } = form
    let commands = yield* PostCommands
    let result = yield* Effect.result(
      commands.updateFiles(values, uploads, filesNoLongerUsed(form)),
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
    return mediaPatch(yield* composerProps(values, [...issues, ...rejected], draftState(result)))
  }).pipe(
    Effect.catchTag('UploadTooLarge', () =>
      Effect.succeed(
        composerPatch([
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
const previewComposer = loggedIn(() =>
  Effect.gen(function* () {
    let form = yield* readForm()
    // Collected first, since deleting while iterating the form would skip entries.
    let files: string[] = []
    form.forEach((value, name) => typeof value !== 'string' && files.push(name))
    for (let name of files) form.delete(name)
    let { values } = readComposeForm(form)
    let result = yield* Effect.result((yield* PostCommands).saveDraft(values))
    return composerPatch(
      [COMPOSER_IDS.preview, <ComposerPreview {...yield* composerProps(values)} />, 'inner'],
      [COMPOSER_IDS.draft, <DraftNote state={draftState(result)} />],
    )
  }),
)

// Dated now. Datastar is sent to the post once it's published, or shown what's wrong.
const publishComposer = loggedIn(() =>
  Effect.gen(function* () {
    let datastar = yield* fromDatastar
    let { values, uploads, issues } = yield* readComposer(yield* readForm())
    let rejectedWith = (issues: readonly PostIssue[]) =>
      Effect.flatMap(composerProps(values, issues), (props) =>
        datastar
          ? Effect.succeed(mediaPatch(props))
          : adminPage('New Post', <ComposePage {...props} />, { status: 400 }),
      )
    let post = composePost(values, dateAtOffset(yield* Clock.currentTimeMillis, values.offset))
    if (post.type === 'text' && post.caption === '' && issues.length === 0) {
      return yield* rejectedWith([
        { message: 'Write something, or add photos, a video, or an article.' },
      ])
    }
    return yield* (yield* PostCommands).publish({ post, uploads, issues }).pipe(
      Effect.map((published) =>
        datastar
          ? composerPatch([
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
const discardComposer = loggedIn(() =>
  Effect.gen(function* () {
    let id = (yield* readForm(LOGIN_FORM_LIMIT)).get('id')
    return yield* (yield* PostCommands).discard(typeof id === 'string' ? id : '').pipe(
      Effect.catchTag('PostRejected', () => Effect.void),
      Effect.as(redirect(routes.admin.newPost(), 303)),
    )
  }),
)

// A post's file for the composer, whether it's published or not.
const postFile = loggedIn(() =>
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

export const AdminRoutes = HttpRouter.addAll([
  HttpRouter.route('GET', '/admin', index),
  HttpRouter.route('GET', '/admin/login', showLogin),
  HttpRouter.route('POST', '/admin/login', logIn),
  HttpRouter.route('POST', '/admin/logout', logOut),
  HttpRouter.route('GET', '/admin/config', showConfig),
  HttpRouter.route('POST', '/admin/config', saveConfig),
  HttpRouter.route('GET', '/admin/posts/new', compose),
  HttpRouter.route('POST', '/admin/posts/new', publishComposer),
  HttpRouter.route('POST', '/admin/posts/new/media', updateComposerMedia),
  HttpRouter.route('POST', '/admin/posts/new/preview', previewComposer),
  HttpRouter.route('POST', '/admin/posts/new/discard', discardComposer),
  HttpRouter.route('GET', '/admin/posts/:id/files/:file', postFile),
  HttpRouter.route('GET', '/admin/posts/:id/edit', editPost),
  HttpRouter.route('POST', '/admin/posts/:id/edit', savePost),
  HttpRouter.route('POST', '/admin/posts/:id/delete', deletePost),
])
