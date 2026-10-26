import type { Html } from '#jsx/jsx-runtime'

import { stylesheet } from '../../components/stylesheet.ts'
import { TURNSTILE_STYLES, TurnstileWidget } from '../../components/turnstile.tsx'
import { Button } from '../../components/ui/button.tsx'
import {
  Field,
  FIELD_STYLES,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '../../components/ui/field.tsx'
import { INPUT_OTP_STYLES, InputOTP } from '../../components/ui/input-otp.tsx'
import { Input, INPUT_STYLES } from '../../components/ui/input.tsx'
import type { SignUpForm, SignUpIssue } from '../../data/users/user.ts'
import { SIGN_UP_CODE_LENGTH, SIGN_UP_CODE_MINUTES } from '../../data/users/user.ts'
import { urls } from '../../lib/urls.ts'
import css from './page.css' with { type: 'text' }

export const SUBSCRIBE_PAGE_STYLES =
  FIELD_STYLES + INPUT_STYLES + INPUT_OTP_STYLES + TURNSTILE_STYLES + stylesheet(css)

// /subscribe: a name, an email address, and Turnstile's widget. Refused, it shows what was typed,
// and why.
export function SubscribePage(props: {
  siteTitle: string
  siteKey: string
  form?: SignUpForm | undefined
  issues?: readonly SignUpIssue[] | undefined
  // Why the form wasn't sent on, if it's not about a field: Turnstile, or the email.
  error?: string | undefined
}): Html {
  let { siteTitle, siteKey, form, issues = [], error } = props
  let issue = (field: SignUpIssue['field']) => issues.find((issue) => issue.field === field)
  let input = (field: SignUpIssue['field'], label: string, attributes: Record<string, unknown>) => {
    let message = issue(field)?.message
    let id = `subscribe-${field}`
    return (
      <Field invalid={message !== undefined}>
        <FieldLabel for={id}>{label}</FieldLabel>
        <Input
          id={id}
          name={field}
          value={form?.[field]}
          required
          aria-invalid={message ? 'true' : undefined}
          aria-describedby={message ? `${id}-error` : undefined}
          {...attributes}
        />
        {message ? <FieldError id={`${id}-error`}>{message}</FieldError> : null}
      </Field>
    )
  }
  return (
    <section class="subscribe">
      <h1 class="page-title">{`Subscribe to ${siteTitle}`}</h1>
      <p>We’ll email you a code to confirm it’s your address.</p>
      <form method="post" action={urls.subscribe()}>
        <FieldGroup>
          {input('name', 'Name', { autocomplete: 'name', maxlength: 100, autofocus: true })}
          {input('email', 'Email', { type: 'email', autocomplete: 'email' })}
          {/* The form doesn't wait for it: without its answer, the server refuses the form. */}
          <Field invalid={error !== undefined}>
            <TurnstileWidget siteKey={siteKey} />
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
          <Button type="submit">Subscribe</Button>
        </FieldGroup>
      </form>
    </section>
  )
}

// /subscribe/verify/<id>: the code with that id, emailed to `email`, and if one was refused, why.
export function SubscribeVerifyPage(props: {
  id: string
  email: string
  error?: string | undefined
}): Html {
  let { id, email, error } = props
  return (
    <section class="subscribe">
      <h1 class="page-title">Check your email</h1>
      <p>
        {`We sent a ${SIGN_UP_CODE_LENGTH}-digit code to ${email}. Enter it below to finish subscribing. It expires in ${SIGN_UP_CODE_MINUTES} minutes.`}
      </p>
      <form method="post" action={urls.subscribeVerify(id)}>
        <FieldGroup>
          <Field invalid={error !== undefined}>
            <FieldLabel for="subscribe-code">Code</FieldLabel>
            <InputOTP
              id="subscribe-code"
              name="code"
              signal="_code"
              length={SIGN_UP_CODE_LENGTH}
              required
              autofocus
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? 'subscribe-code-error' : undefined}
            />
            {error ? <FieldError id="subscribe-code-error">{error}</FieldError> : null}
          </Field>
          <Button type="submit">Verify</Button>
        </FieldGroup>
      </form>
      <p>
        Didn’t get it, or used the wrong address? <a href={urls.subscribe()}>Start again</a>
      </p>
    </section>
  )
}

// When there's no code to enter: it expired, or was used, or entered wrong too many times.
export function SubscribeCodeGonePage(props: { usedUp: boolean }): Html {
  return (
    <section class="subscribe">
      <h1 class="page-title">{props.usedUp ? 'Too many wrong codes' : 'Your code expired'}</h1>
      <p>
        {props.usedUp
          ? 'That code can’t be used any more.'
          : `Codes last ${SIGN_UP_CODE_MINUTES} minutes, and work once.`}{' '}
        <a href={urls.subscribe()}>Ask for a new one</a>
      </p>
    </section>
  )
}

export function SubscribedPage(props: { siteTitle: string; name: string; email: string }): Html {
  return (
    <section class="subscribe">
      <h1 class="page-title">You’re subscribed</h1>
      <p>{`Thanks, ${props.name}. You’re subscribed to ${props.siteTitle} as ${props.email}.`}</p>
      <p>
        <a href={urls.home()}>See all posts</a>
      </p>
    </section>
  )
}

// Subscribing is off, or paused.
export function SubscriptionsClosedPage(props: { siteTitle: string }): Html {
  return (
    <section class="subscribe">
      <h1 class="page-title">Subscribing is closed</h1>
      <p>
        {`${props.siteTitle} isn’t taking subscribers right now. `}
        <a href={urls.home()}>See all posts</a>
      </p>
    </section>
  )
}

// /unsubscribe/<id>/<signature>: asking first, as email apps and their scanners open links on their
// own, and the button posts to it.
export function UnsubscribePage(props: { siteTitle: string; email: string; action: string }): Html {
  return (
    <section class="subscribe">
      <h1 class="page-title">Unsubscribe</h1>
      <p>{`Stop emailing new posts from ${props.siteTitle} to ${props.email}?`}</p>
      <form method="post" action={props.action}>
        <Button type="submit">Unsubscribe</Button>
      </form>
    </section>
  )
}

export function UnsubscribedPage(props: { siteTitle: string }): Html {
  return (
    <section class="subscribe">
      <h1 class="page-title">You’re unsubscribed</h1>
      <p>
        {`You won’t get emails from ${props.siteTitle} any more. `}
        <a href={urls.subscribe()}>Subscribe again</a>
      </p>
    </section>
  )
}

// A link to unsubscribe the site didn't make: cut short, or from before its secret changed.
export function UnsubscribeLinkInvalidPage(): Html {
  return (
    <section class="subscribe">
      <h1 class="page-title">This link isn’t right</h1>
      <p>
        It may have been cut short. Try the Unsubscribe link in a newer email, or reply to one and
        ask.
      </p>
    </section>
  )
}
