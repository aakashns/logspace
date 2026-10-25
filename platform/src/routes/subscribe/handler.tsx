// Subscribing, which signs up for an account: the form (with Turnstile), then the page for the
// code it emails, then the account. Which code the browser is entering is in a cookie, the id of
// the code's row, so the address is never in a URL, and the code can only be entered in the
// browser that asked for it. While subscribing is off or paused, the pages say it's closed.
import { Effect, Layer } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'

import type { Child } from '#jsx/jsx-runtime'
import { Document } from '../../components/document.tsx'
import { configuredSite } from '../../data/site/queries.ts'
import { subscriptionsStatus } from '../../data/site/subscriptions.ts'
import { UserCommands } from '../../data/users/commands.ts'
import { pendingSignUpEmail } from '../../data/users/queries.ts'
import { SIGN_UP_CODE_MINUTES, type SignUpForm, type SignUpIssue } from '../../data/users/user.ts'
import { AppConfig } from '../../lib/config.ts'
import { formText, readForm, SMALL_FORM_LIMIT } from '../../lib/http/forms.ts'
import { pageContext, pageResponse, requestUrl } from '../../lib/http/pages.ts'
import { privately, redirect, textResponse } from '../../lib/http/responses.ts'
import { urls } from '../../lib/urls.ts'
import {
  SUBSCRIBE_PAGE_STYLES,
  SubscribeCodeGonePage,
  SubscribedPage,
  SubscribePage,
  SubscribeVerifyPage,
  SubscriptionsClosedPage,
} from './page.tsx'

const CODE_COOKIE = 'sign_up'

const page = (title: string, content: Child, options?: { status?: number; turnstile?: boolean }) =>
  Effect.gen(function* () {
    let context = yield* pageContext
    let { pathname } = yield* requestUrl
    return privately(
      pageResponse(
        context,
        <Document
          page={context}
          meta={{ path: pathname, title, noindex: true }}
          styles={SUBSCRIBE_PAGE_STYLES}
        >
          {content}
        </Document>,
        options,
      ),
    )
  })

const closed = Effect.gen(function* () {
  let { siteTitle } = yield* configuredSite
  return yield* page('Subscribing is closed', <SubscriptionsClosedPage siteTitle={siteTitle} />, {
    status: 404,
  })
})

// The form, as typed and refused if it was, while subscribing is open.
const subscribeForm = (
  refused?: { form: SignUpForm; issues?: readonly SignUpIssue[]; error?: string },
  status = 200,
) =>
  Effect.gen(function* () {
    let subscriptions = yield* subscriptionsStatus
    if (subscriptions._tag !== 'Open') return yield* closed
    let { siteTitle } = yield* configuredSite
    return yield* page(
      'Subscribe',
      <SubscribePage siteTitle={siteTitle} siteKey={subscriptions.siteKey} {...refused} />,
      { status, turnstile: true },
    )
  })

const showSubscribe = subscribeForm()

const TURNSTILE_MISSING = 'Complete the check that you’re human, then subscribe again.'
const TURNSTILE_FAILED =
  'The check that you’re human didn’t pass. Complete it again, then subscribe.'
const EMAIL_FAILED = 'We couldn’t send the email with your code. Try again in a while.'

// Anyone can send this form, so it's read only up to a few kilobytes. The cookie is `secure`
// in production, which is only served over HTTPS.
const subscribe = (secure: boolean) =>
  Effect.gen(function* () {
    let fields = yield* readForm(SMALL_FORM_LIMIT)
    let form = { name: formText(fields, 'name'), email: formText(fields, 'email') }
    let token = formText(fields, 'cf-turnstile-response')
    return yield* (yield* UserCommands).requestSignUp(form, token).pipe(
      Effect.map((id) =>
        HttpServerResponse.setCookieUnsafe(redirect(urls.subscribeVerify(), 303), CODE_COOKIE, id, {
          httpOnly: true,
          sameSite: 'lax',
          path: urls.subscribe(),
          secure,
          maxAge: `${SIGN_UP_CODE_MINUTES} minutes`,
        }),
      ),
      Effect.catchTags({
        SubscriptionsClosed: () => closed,
        SignUpRejected: ({ issues }) => subscribeForm({ form, issues }, 400),
        TurnstileTokenMissing: () => subscribeForm({ form, error: TURNSTILE_MISSING }, 400),
        TurnstileDenied: () => subscribeForm({ form, error: TURNSTILE_FAILED }, 400),
        TurnstileUnavailable: () => subscribeForm({ form, error: TURNSTILE_FAILED }, 502),
        TurnstileNotSetUp: () => closed,
        SecretUnreadable: () => closed,
        EmailNotSetUp: () => closed,
        EmailAddressInvalid: () =>
          subscribeForm(
            { form, issues: [{ field: 'email', message: 'Expected an email address' }] },
            400,
          ),
        EmailNotSent: () => subscribeForm({ form, error: EMAIL_FAILED }, 502),
      }),
    )
  }).pipe(
    Effect.catchTags({
      UploadTooLarge: () => Effect.succeed(textResponse('Payload Too Large', 413)),
      MalformedForm: () => Effect.succeed(textResponse('Bad Request', 400)),
    }),
  )

// The code's id, from the cookie, and the address it was sent to, while it can be entered.
const pendingCode = Effect.gen(function* () {
  let request = yield* HttpServerRequest.HttpServerRequest
  let id = request.cookies[CODE_COOKIE] ?? ''
  let email = id ? yield* pendingSignUpEmail(id) : undefined
  return email ? { id, email } : undefined
})

const codeGone = (usedUp: boolean) =>
  Effect.map(
    page(
      usedUp ? 'Too many wrong codes' : 'Your code expired',
      <SubscribeCodeGonePage usedUp={usedUp} />,
      {
        status: 410,
      },
    ),
    forgetCode,
  )

const forgetCode = (response: HttpServerResponse.HttpServerResponse) =>
  HttpServerResponse.expireCookieUnsafe(response, CODE_COOKIE, { path: urls.subscribe() })

const showVerify = Effect.gen(function* () {
  if ((yield* subscriptionsStatus)._tag !== 'Open') return yield* closed
  let pending = yield* pendingCode
  if (!pending) return yield* codeGone(false)
  return yield* page('Check your email', <SubscribeVerifyPage email={pending.email} />)
})

const verify = Effect.gen(function* () {
  let code = formText(yield* readForm(SMALL_FORM_LIMIT), 'code')
  let pending = yield* pendingCode
  if (!pending) return yield* codeGone(false)
  return yield* (yield* UserCommands).completeSignUp(pending.id, code).pipe(
    Effect.flatMap(({ name, email }) =>
      Effect.flatMap(configuredSite, ({ siteTitle }) =>
        page(
          'You’re subscribed',
          <SubscribedPage siteTitle={siteTitle} name={name} email={email} />,
        ),
      ),
    ),
    Effect.map(forgetCode),
    Effect.catchTags({
      SubscriptionsClosed: () => closed,
      SignUpCodeExpired: () => codeGone(false),
      SignUpCodeWrong: ({ attemptsLeft }) =>
        attemptsLeft === 0
          ? codeGone(true)
          : page(
              'Check your email',
              <SubscribeVerifyPage
                email={pending.email}
                error={`That code isn’t right. You can try ${attemptsLeft} more ${attemptsLeft === 1 ? 'time' : 'times'}.`}
              />,
              { status: 400 },
            ),
    }),
  )
}).pipe(
  Effect.catchTags({
    UploadTooLarge: () => Effect.succeed(textResponse('Payload Too Large', 413)),
    MalformedForm: () => Effect.succeed(textResponse('Bad Request', 400)),
  }),
)

export const SubscribeRoutes = Layer.unwrap(
  Effect.map(AppConfig, ({ mode }) =>
    HttpRouter.addAll([
      HttpRouter.route('GET', '/subscribe', showSubscribe),
      HttpRouter.route('POST', '/subscribe', subscribe(mode === 'production')),
      HttpRouter.route('GET', '/subscribe/verify', showVerify),
      HttpRouter.route('POST', '/subscribe/verify', verify),
    ]),
  ),
)
