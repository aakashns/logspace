// What every page under /admin shares: the admin layout, a page with a short message, and the
// login that all but the login page need.
import { Effect } from 'effect'
import { HttpServerResponse } from 'effect/http'

import type { Child } from '#jsx/jsx-runtime'
import { MalformedForm, UPLOAD_TOO_LARGE_MESSAGE, UploadTooLarge } from '../../lib/http/forms.ts'
import { pageContext, pageResponse, requestUrl } from '../../lib/http/pages.ts'
import { redirect, textResponse } from '../../lib/http/responses.ts'
import { AdminAuth, type Session } from '../../lib/http/session.ts'
import { urls } from '../../lib/urls.ts'
import { AdminMessage, AdminPage } from './layout.tsx'

// An admin page's response.
export const adminPage = (
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

export const message = (title: string, text: Child, status: number) =>
  adminPage(title, <AdminMessage title={title}>{text}</AdminMessage>, { status })

// Keeps these pages out of caches and search results.
export const privately = (response: HttpServerResponse.HttpServerResponse) =>
  HttpServerResponse.setHeaders(response, {
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex',
  })

// An admin page that needs a login: anyone else is sent to the login page, before a byte of what
// they sent is read. A form over the upload limits gets a page saying so.
export const loggedIn = <R,>(
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
        Effect.map(AdminAuth, (auth) => auth.saveSession(redirect(urls.admin.login()), undefined)),
      UploadTooLarge: () => message('Upload too large', UPLOAD_TOO_LARGE_MESSAGE, 413),
      MalformedForm: () => Effect.succeed(textResponse('Bad Request', 400)),
    }),
    Effect.map(privately),
  )
