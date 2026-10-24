// Logging in to /admin and out.
import { Effect } from 'effect'
import { HttpRouter } from 'effect/http'

import { LOGIN_FORM_LIMIT, readForm, UPLOAD_TOO_LARGE_MESSAGE } from '../../../lib/http/forms.ts'
import { redirect } from '../../../lib/http/responses.ts'
import { AdminAuth } from '../../../lib/http/session.ts'
import { urls } from '../../../lib/urls.ts'
import { adminPage, message, privately } from '../admin.tsx'
import { LOGIN_PAGE_STYLES, LoginPage } from './page.tsx'

const loginPage = (error?: string) =>
  Effect.gen(function* () {
    let { enabled } = yield* AdminAuth
    return yield* adminPage('Log in', <LoginPage enabled={enabled} error={error} />, {
      styles: LOGIN_PAGE_STYLES,
      status: error ? 401 : 200,
      loggedIn: false,
    })
  })

const showLogin = Effect.gen(function* () {
  let auth = yield* AdminAuth
  let loggedIn = yield* Effect.isSuccess(auth.requireLogin)
  return privately(loggedIn ? redirect(urls.admin.index()) : yield* loginPage())
})

// Anyone can send this form, so it's read only up to a few kilobytes.
const logIn = Effect.gen(function* () {
  let auth = yield* AdminAuth
  let form = yield* readForm(LOGIN_FORM_LIMIT)
  let session = yield* auth.logIn(form.get('password'))
  if (!session) {
    return yield* loginPage('That password isn’t right.')
  }
  return auth.saveSession(redirect(urls.admin.index()), session)
}).pipe(
  Effect.catchTags({
    UploadTooLarge: () => message('Upload too large', UPLOAD_TOO_LARGE_MESSAGE, 413),
    MalformedForm: () => loginPage('That password isn’t right.'),
  }),
  Effect.map(privately),
)

const logOut = Effect.gen(function* () {
  let auth = yield* AdminAuth
  yield* auth.logOut
  return privately(auth.saveSession(redirect(urls.admin.login()), undefined))
})

export const LoginRoutes = HttpRouter.addAll([
  HttpRouter.route('GET', '/admin/login', showLogin),
  HttpRouter.route('POST', '/admin/login', logIn),
  HttpRouter.route('POST', '/admin/logout', logOut),
])
