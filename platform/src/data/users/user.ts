// Someone's account (a row of the `users` table, after better-auth's `user`), and signing up for
// one with a code emailed to them: what the form must say, and the code waiting to be entered (a
// row of the `verifications` table, after better-auth's `verification`). For now, signing up is
// subscribing, at /subscribe.
import { createHash } from 'node:crypto'
import { Result, Schema } from 'effect'

import { isEmailAddress } from '../site/site.ts'

export const SIGN_UP_CODE_LENGTH = 6
// Long enough to switch to an inbox and back.
export const SIGN_UP_CODE_MINUTES = 10
// Wrong codes before it's used up, as better-auth's email-OTP plugin allows.
export const SIGN_UP_CODE_ATTEMPTS = 3
// How often codes can be sent to an address: at most 5 within an hour of each other, and at
// least 30 seconds apart, so the form can't be used to flood someone's inbox.
export const SIGN_UP_CODES_PER_HOUR = 5
export const SIGN_UP_CODE_GAP_SECONDS = 30

// The sign-up form, trimmed.
export interface SignUpForm {
  readonly name: string
  readonly email: string
}

export interface SignUpIssue {
  readonly field: keyof SignUpForm
  readonly message: string
}

// Checks the form, with the address lowercased, as accounts are found by it.
export function checkSignUp(form: SignUpForm): Result.Result<SignUpForm, SignUpIssue[]> {
  let issues: SignUpIssue[] = []
  // It goes in the emails' greeting, so it's one line.
  if (!form.name) issues.push({ field: 'name', message: 'Enter your name' })
  else if (form.name.length > 100 || /\p{Cc}/u.test(form.name)) {
    issues.push({ field: 'name', message: 'Expected a name on one line, of up to 100 characters' })
  }
  let email = form.email.toLowerCase()
  if (!email) issues.push({ field: 'email', message: 'Enter your email address' })
  else if (!isEmailAddress(email)) {
    issues.push({ field: 'email', message: 'Expected an email address, like you@example.com' })
  }
  return issues.length > 0 ? Result.fail(issues) : Result.succeed({ name: form.name, email })
}

// The `identifier` of the code for signing up with an address, named as better-auth's email-OTP
// plugin names its codes ("<what it's for>-otp-<email>").
const SIGN_UP_PREFIX = 'sign-up-otp-'
// The `key` of how many codes were sent to an address lately, in the `rate_limits` table.
export const signUpRateLimitKey = (email: string) => `sign-up-otp:${email}`
export const signUpIdentifier = (email: string) => SIGN_UP_PREFIX + email
// The address a sign-up's code was sent to, from its identifier.
export const signUpEmail = (identifier: string) =>
  identifier.startsWith(SIGN_UP_PREFIX) ? identifier.slice(SIGN_UP_PREFIX.length) : undefined

// The `value` of a sign-up's code: the code's hash (only whoever has the email knows the code),
// the name typed, for the account it makes, and how many wrong codes have been tried.
export const PendingSignUp = Schema.Struct({
  code: Schema.String,
  name: Schema.String,
  attempts: Schema.Int,
})
export type PendingSignUp = typeof PendingSignUp.Type

export const hashCode = (code: string) => createHash('sha256').update(code).digest('base64url')

// A code as typed or pasted, without spaces.
export const typedCode = (typed: string) => typed.replace(/\s/g, '')
