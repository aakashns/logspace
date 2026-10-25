import type { Child, Html } from '#jsx/jsx-runtime'

import { stylesheet } from '../../../components/stylesheet.ts'
import { UNREADABLE_SECRET_MESSAGE, type TurnstileIssue } from '../../../data/site/site.ts'
import type { TurnstileFailure, TurnstileStatus } from '../../../data/site/turnstile.ts'
import { urls } from '../../../lib/urls.ts'
import { Field, TextField } from '../fields.tsx'
import { BackLink } from '../layout.tsx'
import css from './page.css' with { type: 'text' }

export const INTEGRATIONS_PAGE_STYLES = stylesheet(css)

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js'

// How checking the widget's answer with Cloudflare went.
export type TurnstileVerification =
  { readonly _tag: 'Verified'; readonly hostname: string } | TurnstileFailure

export interface TurnstileSectionProps {
  readonly status: TurnstileStatus
  // Set on the page shown after saving or removing the keys.
  readonly notice?: 'saved' | 'removed' | undefined
  // A rejected form: the site key that was typed (never the secret key), and why.
  readonly rejected?: { siteKey: string; issues: readonly TurnstileIssue[] } | undefined
  readonly verification?: TurnstileVerification | undefined
}

// /admin/integrations: a section for each service the site connects to.
export function IntegrationsPage(props: { turnstile: TurnstileSectionProps }): Html {
  return (
    <section class="admin-page">
      <BackLink />
      <h1 class="page-title">Integrations</h1>
      <p class="muted">
        Services the site connects to. Their secret keys are stored encrypted with the server’s
        AUTH_SESSION_SECRET, and never shown again once saved.
      </p>
      <TurnstileSection {...props.turnstile} />
    </section>
  )
}

const STATUS_LABELS: Record<TurnstileStatus['_tag'], string> = {
  NotSetUp: 'Not connected',
  SetUp: 'Connected',
  SecretUnreadable: 'Needs its secret key again',
}

const SECRET_HINTS = {
  NotSetUp: 'Sent only to Cloudflare, to check the widget’s answers.',
  SecretUnreadable: UNREADABLE_SECRET_MESSAGE,
} as const

function TurnstileSection(props: TurnstileSectionProps): Html {
  let { status, notice, rejected, verification } = props
  let invalid = (field: TurnstileIssue['field']) =>
    rejected?.issues.some((issue) => issue.field === field) ? ('true' as const) : undefined
  let siteKey = status._tag === 'NotSetUp' ? '' : status.siteKey
  return (
    <section class="integration" aria-labelledby="turnstile-heading">
      <div class="integration-heading">
        <h2 id="turnstile-heading">Cloudflare Turnstile</h2>
        <p class={status._tag === 'SetUp' ? 'integration-status' : 'integration-status muted'}>
          {STATUS_LABELS[status._tag]}
        </p>
      </div>
      <p class="muted">
        Tells people from bots, without a puzzle, on forms anyone can send. Add a widget in{' '}
        <a href="https://dash.cloudflare.com/?to=/:account/turnstile">Cloudflare’s dashboard</a>{' '}
        with this site’s domain as a hostname, then copy its keys here.
      </p>
      {notice === 'saved' ? (
        <p role="status" class="notice">
          Saved. Try the widget below.
        </p>
      ) : null}
      {notice === 'removed' ? (
        <p role="status" class="notice">
          Disconnected, and its keys forgotten.
        </p>
      ) : null}
      {rejected ? (
        <div role="alert" class="alert">
          <p>The keys weren’t saved.</p>
          <ul>
            {rejected.issues.map((issue) => (
              <li>{`${issue.field === 'siteKey' ? 'Site key' : 'Secret key'}: ${issue.message}`}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <form method="post" action={urls.admin.saveTurnstile()} class="form">
        <TextField
          label="Site key"
          name="siteKey"
          id="turnstile-siteKey"
          value={rejected?.siteKey ?? siteKey}
          invalid={invalid('siteKey')}
          hint="Public: pages show it to load the widget."
        />
        <Field
          label="Secret key"
          for="turnstile-secretKey"
          hint={
            status._tag === 'SetUp'
              ? 'Leave it empty to keep the saved one.'
              : SECRET_HINTS[status._tag]
          }
        >
          {/* The saved one, masked: only its last characters are sent to the browser. */}
          <input
            id="turnstile-secretKey"
            name="secretKey"
            type="password"
            autocomplete="off"
            placeholder={
              status._tag === 'SetUp' ? `${'•'.repeat(12)}${status.secretKeyEnding}` : undefined
            }
            aria-invalid={invalid('secretKey')}
            class="input"
          />
        </Field>
        <div class="actions">
          <button type="submit" class="button">
            Save
          </button>
          {status._tag === 'NotSetUp' ? null : (
            <button
              type="submit"
              formaction={urls.admin.removeTurnstile()}
              class="destructive-button"
            >
              Disconnect
            </button>
          )}
        </div>
      </form>
      {status._tag === 'NotSetUp' ? (
        // Disconnected since the page with the widget was shown.
        verification ? (
          <VerificationResult verification={verification} />
        ) : null
      ) : (
        <TurnstileTry siteKey={status.siteKey} verification={verification} />
      )}
    </section>
  )
}

// The widget, with the saved site key, and a button that checks its answer with Cloudflare
// using the secret key, which shows both keys work together.
function TurnstileTry(props: {
  siteKey: string
  verification: TurnstileVerification | undefined
}): Html {
  let { siteKey, verification } = props
  return (
    <div class="turnstile-try">
      <h3>Try it</h3>
      <p class="muted">
        Complete the challenge, then verify its answer with Cloudflare. If the widget shows an error
        instead, check that this site’s domain is one of its hostnames on Cloudflare.
      </p>
      {verification ? <VerificationResult verification={verification} /> : null}
      <form method="post" action={urls.admin.verifyTurnstile()} class="form">
        {/* The widget fills this in, and adds the token to the form. */}
        <div class="cf-turnstile" data-sitekey={siteKey} data-ignore></div>
        <div class="actions">
          <button type="submit" class="secondary-button">
            Verify
          </button>
        </div>
      </form>
      <script src={TURNSTILE_SCRIPT} async defer></script>
    </div>
  )
}

function VerificationResult(props: { verification: TurnstileVerification }): Html {
  let { verification } = props
  if (verification._tag === 'Verified') {
    return (
      <p role="status" class="notice">
        Verified: Cloudflare accepted the answer
        {verification.hostname ? `, solved on ${verification.hostname}` : ''}. Turnstile works.
      </p>
    )
  }
  return (
    <div role="alert" class="alert">
      {failureMessage(verification)}
    </div>
  )
}

// What each of Cloudflare's error codes means for whoever's setting it up.
const DENIAL_MESSAGES: Record<string, string> = {
  'missing-input-secret': 'Cloudflare didn’t get the secret key.',
  'invalid-input-secret':
    'Cloudflare doesn’t recognize the secret key. Check that it’s this widget’s (a test secret key only works with a test site key).',
  'missing-input-response': 'Cloudflare didn’t get the challenge’s answer.',
  'invalid-input-response':
    'The challenge’s answer isn’t valid. Check that the site key and secret key are from the same widget.',
  'timeout-or-duplicate':
    'The challenge’s answer expired (they last five minutes) or was already verified. Complete it again.',
  'bad-request': 'Cloudflare refused the request as malformed.',
  'internal-error': 'Cloudflare had an internal error. Try again.',
}

function failureMessage(failure: TurnstileFailure): Child {
  switch (failure._tag) {
    case 'TurnstileNotSetUp':
      return 'Turnstile isn’t connected: save its keys first.'
    case 'SecretUnreadable':
      return UNREADABLE_SECRET_MESSAGE
    case 'TurnstileTokenMissing':
      return 'Complete the challenge first. The widget needs JavaScript, and can take a moment to load.'
    case 'TurnstileDenied':
      if (failure.codes.length === 0) return 'Cloudflare refused the answer, without saying why.'
      return (
        <ul>
          {failure.codes.map((code) => (
            <li>{DENIAL_MESSAGES[code] ?? `Cloudflare refused the answer: ${code}.`}</li>
          ))}
        </ul>
      )
    case 'TurnstileUnavailable':
      switch (failure.reason) {
        case 'network':
          return 'Couldn’t reach Cloudflare. Check the server’s connection to the internet, then try again.'
        case 'timeout':
          return 'Cloudflare didn’t answer within 10 seconds. Try again.'
        case 'status':
          return `Cloudflare answered with an error (HTTP ${failure.status ?? 'error'}). Try again later.`
        case 'response':
          return 'Cloudflare’s answer couldn’t be read. Try again later.'
      }
  }
}
