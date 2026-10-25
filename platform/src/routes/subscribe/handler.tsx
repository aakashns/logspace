// Subscribing, which signs up for an account: the form (with Turnstile), then the page for the
// code it emails, then the account. The code's page is at the id of its row, which is random and
// says nothing about the address, and each code has its own, so an old page, or someone else's
// asking for a code for the same address, can't touch it. While subscribing is off or paused, the
// pages say it's closed.
import { Effect } from 'effect'
import { HttpRouter } from 'effect/http'

import type { Child } from '#jsx/jsx-runtime'
import { Document } from '../../components/document.tsx'
import { configuredSite } from '../../data/site/queries.ts'
import { subscriptionsStatus } from '../../data/site/subscriptions.ts'
import { type SignUpRateLimited, UserCommands } from '../../data/users/commands.ts'
import { pendingSignUpEmail } from '../../data/users/queries.ts'
import type { SignUpForm, SignUpIssue } from '../../data/users/user.ts'
import { formText, readForm, SMALL_FORM_LIMIT } from '../../lib/http/forms.ts'
import { pageContext, pageResponse, param, requestUrl } from '../../lib/http/pages.ts'
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

// Anyone can send this form, so it's read only up to a few kilobytes.
const subscribe = Effect.gen(function* () {
  let fields = yield* readForm(SMALL_FORM_LIMIT)
  let form = { name: formText(fields, 'name'), email: formText(fields, 'email') }
  let token = formText(fields, 'cf-turnstile-response')
  return yield* (yield* UserCommands).requestSignUp(form, token).pipe(
    Effect.map((id) => redirect(urls.subscribeVerify(id), 303)),
    Effect.catchTags({
      SubscriptionsClosed: () => closed,
      SignUpRejected: ({ issues }) => subscribeForm({ form, issues }, 400),
      SignUpRateLimited: (limited) =>
        subscribeForm(
          { form, issues: [{ field: 'email', message: rateLimitMessage(limited) }] },
          429,
        ),
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

function rateLimitMessage(limited: SignUpRateLimited): string {
  if (limited.reason === 'just') {
    return `A code was just sent to this address. You can ask for another in ${limited.retryAfter} seconds.`
  }
  let minutes = Math.ceil(limited.retryAfter / 60)
  return `Too many codes were sent to this address. You can ask for another in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`
}

const codeGone = (usedUp: boolean) =>
  page(
    usedUp ? 'Too many wrong codes' : 'Your code expired',
    <SubscribeCodeGonePage usedUp={usedUp} />,
    { status: 410 },
  )

const showVerify = Effect.gen(function* () {
  if ((yield* subscriptionsStatus)._tag !== 'Open') return yield* closed
  let id = yield* param('id')
  let email = yield* pendingSignUpEmail(id)
  if (!email) return yield* codeGone(false)
  return yield* page('Check your email', <SubscribeVerifyPage id={id} email={email} />)
})

const verify = Effect.gen(function* () {
  let id = yield* param('id')
  let code = formText(yield* readForm(SMALL_FORM_LIMIT), 'code')
  return yield* (yield* UserCommands).completeSignUp(id, code).pipe(
    Effect.flatMap(({ name, email }) =>
      Effect.flatMap(configuredSite, ({ siteTitle }) =>
        page(
          'You’re subscribed',
          <SubscribedPage siteTitle={siteTitle} name={name} email={email} />,
        ),
      ),
    ),
    Effect.catchTags({
      SubscriptionsClosed: () => closed,
      SignUpCodeExpired: () => codeGone(false),
      SignUpCodeWrong: ({ attemptsLeft }) =>
        attemptsLeft === 0
          ? codeGone(true)
          : Effect.flatMap(pendingSignUpEmail(id), (email) =>
              page(
                'Check your email',
                <SubscribeVerifyPage
                  id={id}
                  email={email ?? ''}
                  error={`That code isn’t right. You can try ${attemptsLeft} more ${attemptsLeft === 1 ? 'time' : 'times'}.`}
                />,
                { status: 400 },
              ),
            ),
    }),
  )
}).pipe(
  Effect.catchTags({
    UploadTooLarge: () => Effect.succeed(textResponse('Payload Too Large', 413)),
    MalformedForm: () => Effect.succeed(textResponse('Bad Request', 400)),
  }),
)

export const SubscribeRoutes = HttpRouter.addAll([
  HttpRouter.route('GET', '/subscribe', showSubscribe),
  HttpRouter.route('POST', '/subscribe', subscribe),
  HttpRouter.route('GET', '/subscribe/verify/:id', showVerify),
  HttpRouter.route('POST', '/subscribe/verify/:id', verify),
])
