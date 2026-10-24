// The pages under /admin, for managing the site: logging in and out, the list of posts, the
// site's settings, and writing, editing, and deleting posts. Every handler here only reads and
// sends commands; what a command does is in commands/.
import { Clock, Effect } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/http'

import type { Child } from '#jsx/jsx-runtime'
import { PostCommands } from '../commands/posts.ts'
import { SiteConfigCommands } from '../commands/site-config.ts'
import { newPostDate, readPostForm, type PostFormValues } from '../domain/post-form.ts'
import { isPostId, newPostId, type PostIssue } from '../domain/post.ts'
import {
  isSiteConfigured,
  SITE_IMAGE_KINDS,
  type SiteConfigIssue,
  type SiteImageKind,
  type SiteText,
} from '../domain/site.ts'
import { PostQueries } from '../queries/posts.ts'
import { SiteConfigQueries } from '../queries/site-config.ts'
import { routes } from '../routes.ts'
import { AdminMessage, AdminPage } from '../views/admin/page.tsx'
import { ConfigPage } from '../views/admin/config.tsx'
import { LoginPage } from '../views/admin/login.tsx'
import { PostForm } from '../views/admin/post-form.tsx'
import { PostsPage } from '../views/admin/posts.tsx'
import {
  LOGIN_FORM_LIMIT,
  MalformedForm,
  readForm,
  UPLOAD_TOO_LARGE_MESSAGE,
  UploadTooLarge,
} from './forms.ts'
import { pageContext, pageResponse, param, requestUrl } from './pages.ts'
import { redirect, textResponse } from './responses.ts'
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
      NotLoggedIn: () => Effect.succeed(redirect(routes.admin.login())),
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

const postForm = (props: {
  isNew: boolean
  values: PostFormValues
  issues?: readonly PostIssue[] | undefined
}) =>
  Effect.gen(function* () {
    let { id } = props.values
    let files = isPostId(id) ? yield* (yield* PostQueries).files(id) : []
    return yield* adminPage(
      props.isNew ? 'New Post' : 'Edit Post',
      <PostForm {...props} files={files} />,
      {
        status: props.issues ? 400 : 200,
      },
    )
  })

const newPost = loggedIn(() =>
  Effect.gen(function* () {
    let [newest] = yield* (yield* PostQueries).all
    let now = yield* Clock.currentTimeMillis
    let values = { id: newPostId(), type: 'text', date: newPostDate(newest?.date, now) }
    return yield* postForm({ isNew: true, values })
  }),
)

const publishPost = loggedIn(() =>
  Effect.gen(function* () {
    let formData = yield* readForm()
    let id = formData.get('id')
    let form = readPostForm(formData, typeof id === 'string' ? id : '')
    return yield* (yield* PostCommands).publish(form).pipe(
      Effect.map((post) => redirect(routes.post(post.id), 303)),
      Effect.catchTag('PostRejected', (rejected) =>
        postForm({ isNew: true, values: form.post, issues: rejected.issues }),
      ),
    )
  }),
)

const editPost = loggedIn(() =>
  Effect.gen(function* () {
    let values = yield* (yield* PostQueries).findRecord(yield* param('id'))
    if (!values) return yield* postNotFound
    return yield* postForm({ isNew: false, values })
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
        PostRejected: (rejected) =>
          postForm({ isNew: false, values: form.post, issues: rejected.issues }),
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

export const AdminRoutes = HttpRouter.addAll([
  HttpRouter.route('GET', '/admin', index),
  HttpRouter.route('GET', '/admin/login', showLogin),
  HttpRouter.route('POST', '/admin/login', logIn),
  HttpRouter.route('POST', '/admin/logout', logOut),
  HttpRouter.route('GET', '/admin/config', showConfig),
  HttpRouter.route('POST', '/admin/config', saveConfig),
  HttpRouter.route('GET', '/admin/posts/new', newPost),
  HttpRouter.route('POST', '/admin/posts/new', publishPost),
  HttpRouter.route('GET', '/admin/posts/:id/edit', editPost),
  HttpRouter.route('POST', '/admin/posts/:id/edit', savePost),
  HttpRouter.route('POST', '/admin/posts/:id/delete', deletePost),
])
