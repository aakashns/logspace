// Logging in to /admin and out.
import { Effect, Result } from 'effect'
import { HttpRouter } from 'effect/http'

import { SiteConfigQueries } from '../../../data/site/queries.ts'
import { Turnstile } from '../../../data/site/turnstile.ts'
import {
  formText,
  SMALL_FORM_LIMIT,
  readForm,
  UPLOAD_TOO_LARGE_MESSAGE,
} from '../../../lib/http/forms.ts'
import { redirect } from '../../../lib/http/responses.ts'
import { AdminAuth } from '../../../lib/http/admin-session.ts'
import { urls } from '../../../lib/urls.ts'
import { adminPage, message, privately } from '../admin.tsx'
import { ADMIN_LOGIN_PAGE_STYLES, AdminLoginPage } from './page.tsx'

const WRONG_PASSWORD = 'That password isn’t right.'

// The form, and why it was refused. It shows Turnstile's widget while it's enabled.
const loginPage = (errors?: { password?: string; turnstile?: string }) =>
  Effect.gen(function* () {
    let { enabled } = yield* AdminAuth
    let saved = (yield* (yield* SiteConfigQueries).saved).turnstile
    let turnstile =
      enabled && saved?.enabled ? { siteKey: saved.siteKey, error: errors?.turnstile } : undefined
    return yield* adminPage(
      'Log in',
      <AdminLoginPage enabled={enabled} error={errors?.password} turnstile={turnstile} />,
      {
        styles: ADMIN_LOGIN_PAGE_STYLES,
        status: errors ? 401 : 200,
        loggedIn: false,
        turnstile: turnstile !== undefined,
      },
    )
  })

const showLogin = Effect.gen(function* () {
  let auth = yield* AdminAuth
  let loggedIn = yield* Effect.isSuccess(auth.requireLogin)
  return privately(loggedIn ? redirect(urls.admin.index()) : yield* loginPage())
})

// Anyone can send this form, so it's read only up to a few kilobytes. Turnstile is checked before
// the password, so guessing it takes passing Turnstile each time.
const logIn = Effect.gen(function* () {
  let auth = yield* AdminAuth
  let form = yield* readForm(SMALL_FORM_LIMIT)
  let checked = yield* Effect.result(
    (yield* Turnstile).checkAdminLogin(formText(form, 'cf-turnstile-response')),
  )
  if (Result.isFailure(checked)) {
    return yield* loginPage({
      turnstile:
        checked.failure._tag === 'TurnstileTokenMissing'
          ? 'Complete the check that you’re human, then log in again.'
          : 'The check that you’re human didn’t pass. Complete it again, then log in.',
    })
  }
  let session = yield* auth.logIn(form.get('password'))
  if (!session) {
    return yield* loginPage({ password: WRONG_PASSWORD })
  }
  return auth.saveSession(redirect(urls.admin.index()), session)
}).pipe(
  Effect.catchTags({
    UploadTooLarge: () => message('Upload too large', UPLOAD_TOO_LARGE_MESSAGE, 413),
    MalformedForm: () => loginPage({ password: WRONG_PASSWORD }),
  }),
  Effect.map(privately),
)

const logOut = Effect.gen(function* () {
  let auth = yield* AdminAuth
  yield* auth.logOut
  return privately(auth.saveSession(redirect(urls.admin.login()), undefined))
})

export const AdminLoginRoutes = HttpRouter.addAll([
  HttpRouter.route('GET', '/admin/login', showLogin),
  HttpRouter.route('POST', '/admin/login', logIn),
  HttpRouter.route('POST', '/admin/logout', logOut),
])
