// Logging in to /admin and out.
import { Effect } from 'effect'

import { routes } from '../../routes.ts'
import { LoginPage } from '../../views/admin/login.tsx'
import { LOGIN_FORM_LIMIT, readForm, UPLOAD_TOO_LARGE_MESSAGE } from '../forms.ts'
import { redirect } from '../responses.ts'
import { AdminAuth } from '../session.ts'
import { adminPage, message, privately } from './pages.tsx'

const loginPage = (error?: string) =>
  Effect.gen(function* () {
    let { enabled } = yield* AdminAuth
    return yield* adminPage('Log in', <LoginPage enabled={enabled} error={error} />, {
      status: error ? 401 : 200,
      loggedIn: false,
    })
  })

export const showLogin = Effect.gen(function* () {
  let auth = yield* AdminAuth
  let loggedIn = yield* Effect.isSuccess(auth.requireLogin)
  return privately(loggedIn ? redirect(routes.admin.index()) : yield* loginPage())
})

// Anyone can send this form, so it's read only up to a few kilobytes.
export const logIn = Effect.gen(function* () {
  let auth = yield* AdminAuth
  let form = yield* readForm(LOGIN_FORM_LIMIT)
  let session = yield* auth.logIn(form.get('password'))
  if (!session) {
    return yield* loginPage('That password isn’t right.')
  }
  return auth.saveSession(redirect(routes.admin.index()), session)
}).pipe(
  Effect.catchTags({
    UploadTooLarge: () => message('Upload too large', UPLOAD_TOO_LARGE_MESSAGE, 413),
    MalformedForm: () => loginPage('That password isn’t right.'),
  }),
  Effect.map(privately),
)

export const logOut = Effect.gen(function* () {
  let auth = yield* AdminAuth
  yield* auth.logOut
  return privately(auth.saveSession(redirect(routes.admin.login()), undefined))
})
