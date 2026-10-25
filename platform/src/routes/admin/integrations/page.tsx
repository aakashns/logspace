import type { Child, Html } from '#jsx/jsx-runtime'

import { stylesheet } from '../../../components/stylesheet.ts'
import { CaretDownIcon } from '../../../components/icons.tsx'
import { TURNSTILE_STYLES, TurnstileWidget } from '../../../components/turnstile.tsx'
import { Alert, ALERT_STYLES, AlertDescription, AlertTitle } from '../../../components/ui/alert.tsx'
import { Badge, BADGE_STYLES } from '../../../components/ui/badge.tsx'
import { Button } from '../../../components/ui/button.tsx'
import { Checkbox, CHECKBOX_STYLES } from '../../../components/ui/checkbox.tsx'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '../../../components/ui/field.tsx'
import { Input } from '../../../components/ui/input.tsx'
import { NativeSelect, NATIVE_SELECT_STYLES } from '../../../components/ui/native-select.tsx'
import { Separator, SEPARATOR_STYLES } from '../../../components/ui/separator.tsx'
import type { EmailFailure, EmailStatus } from '../../../data/site/email.ts'
import {
  type EmailForm,
  type EmailIssue,
  type TurnstileIssue,
  unreadableSecretMessage,
} from '../../../data/site/site.ts'
import type { TurnstileFailure, TurnstileStatus } from '../../../data/site/turnstile.ts'
import { urls } from '../../../lib/urls.ts'
import { FIELDS_STYLES, hintId, LabelledField, TextField } from '../fields.tsx'
import { BackLink } from '../layout.tsx'
import css from './page.css' with { type: 'text' }

export const INTEGRATIONS_PAGE_STYLES =
  FIELDS_STYLES +
  ALERT_STYLES +
  BADGE_STYLES +
  CHECKBOX_STYLES +
  NATIVE_SELECT_STYLES +
  SEPARATOR_STYLES +
  TURNSTILE_STYLES +
  stylesheet(css)

// How checking the widget's answer with Cloudflare went.
export type TurnstileVerification =
  { readonly _tag: 'Verified'; readonly hostname: string } | TurnstileFailure

export interface TurnstileSectionProps {
  readonly status: TurnstileStatus
  // Set on the page shown after saving or removing the keys.
  readonly notice?: 'saved' | 'removed' | undefined
  // A rejected form: the site key that was typed (never the secret key), whether it was to be
  // enabled, and why.
  readonly rejected?:
    { siteKey: string; enabled: boolean; issues: readonly TurnstileIssue[] } | undefined
  readonly verification?: TurnstileVerification | undefined
}

// How sending a test email went.
export type EmailTest = { readonly _tag: 'Sent'; readonly to: string } | EmailFailure

export interface EmailSectionProps {
  readonly status: EmailStatus
  // Set on the page shown after saving or removing the settings.
  readonly notice?: 'saved' | 'removed' | undefined
  // A rejected form, as typed (but for the password and API key), and why.
  readonly rejected?: { form: EmailForm; issues: readonly EmailIssue[] } | undefined
  // A test email that was sent, or not, and the address it was for.
  readonly test?: { result: EmailTest; to: string } | undefined
}

// /admin/integrations: a collapsible section for each service the site connects to.
export function IntegrationsPage(props: {
  turnstile: TurnstileSectionProps
  email: EmailSectionProps
}): Html {
  return (
    <section class="admin-page">
      <BackLink />
      <h1 class="page-title">Integrations</h1>
      <p class="muted">
        Services the site connects to. Secret keys are encrypted and not shown once entered.
      </p>
      <div class="integrations">
        <TurnstileSection {...props.turnstile} />
        <EmailSection {...props.email} />
        <Separator />
      </div>
    </section>
  )
}

const STATUSES = {
  NotSetUp: { label: 'Not connected', variant: 'secondary' },
  SetUp: { label: 'Connected', variant: 'default' },
  SecretUnreadable: { label: 'Needs its secret key again', variant: 'destructive' },
} as const satisfies Record<TurnstileStatus['_tag'], { label: string; variant: string }>

const EMAIL_STATUSES = {
  NotSetUp: { label: 'Not set up', variant: 'secondary' },
  SetUp: { label: 'Set up', variant: 'default' },
  SecretUnreadable: { label: 'Needs its secret again', variant: 'destructive' },
} as const satisfies Record<EmailStatus['_tag'], { label: string; variant: string }>

const EMAIL_FIELDS: Record<EmailIssue['field'], string> = {
  provider: 'Send with',
  fromName: 'From name',
  from: 'From',
  replyTo: 'Reply-to',
  sesRegion: 'Region',
  sesEndpoint: 'Endpoint',
  sesAccessKeyId: 'Access key ID',
  sesSecretAccessKey: 'Secret access key',
  resendApiKey: 'API key',
}

// The settings as they're saved, as the form shows them, or before they are, with SES's endpoint
// in us-east-1 filled in, to change. The secrets are never sent to the browser.
function savedEmailForm(status: EmailStatus): EmailForm {
  let empty = {
    provider: 'ses',
    fromName: '',
    from: '',
    replyTo: '',
    sesRegion: '',
    sesEndpoint: 'https://email.us-east-1.amazonaws.com',
    sesAccessKeyId: '',
    sesSecretAccessKey: '',
    resendApiKey: '',
  }
  if (status._tag === 'NotSetUp') return empty
  let { fromName, from, replyTo, provider } = status.settings
  let form = { ...empty, provider: provider._tag, fromName, from, replyTo }
  if (provider._tag === 'resend') return form
  return {
    ...form,
    sesRegion: provider.region,
    sesEndpoint: provider.endpoint,
    sesAccessKeyId: provider.accessKeyId,
  }
}

// Typing a region changes the endpoint to SES's in that region, if it's SES's in another (not, say,
// the site's fake of SES, in development).
const FOLLOW_REGION =
  'const endpoint = el.form.sesEndpoint; ' +
  "if (endpoint.value.startsWith('https://email.') && endpoint.value.endsWith('.amazonaws.com')) " +
  "endpoint.value = 'https://email.' + el.value.trim() + '.amazonaws.com'"

function EmailSection(props: EmailSectionProps): Html {
  let { status, notice, rejected, test } = props
  let form = rejected?.form ?? savedEmailForm(status)
  let invalid = (field: EmailIssue['field']) =>
    rejected?.issues.some((issue) => issue.field === field) ? ('true' as const) : undefined
  let badge = EMAIL_STATUSES[status._tag]
  let saved = status._tag === 'NotSetUp' ? undefined : status.settings.provider._tag
  // The secret's field. Left empty, for the saved provider, it keeps the saved one: its last
  // characters say which it is.
  let secretField = (field: 'sesSecretAccessKey' | 'resendApiKey', hint: string) => {
    let provider = field === 'sesSecretAccessKey' ? 'ses' : 'resend'
    let what = field === 'sesSecretAccessKey' ? 'secret access key' : 'API key'
    let id = `email-${field}`
    let placeholder =
      status._tag === 'SetUp' && saved === provider
        ? `${'•'.repeat(12)}${status.secretEnding}`
        : undefined
    return (
      <LabelledField
        label={EMAIL_FIELDS[field]}
        for={id}
        hint={
          status._tag === 'SecretUnreadable' && saved === provider
            ? unreadableSecretMessage(what)
            : placeholder
              ? 'Leave it empty to keep the saved one.'
              : hint
        }
      >
        <Input
          id={id}
          name={field}
          type="password"
          autocomplete="off"
          placeholder={placeholder}
          aria-invalid={invalid(field)}
          aria-describedby={hintId(id)}
        />
      </LabelledField>
    )
  }
  return (
    <Integration
      id="email"
      title="Email"
      badge={<Badge variant={badge.variant}>{badge.label}</Badge>}
      open={notice !== undefined || rejected !== undefined || test !== undefined}
    >
      <p class="muted">
        How the site sends email: with <a href="https://aws.amazon.com/ses/">Amazon SES</a> or{' '}
        <a href="https://resend.com">Resend</a>.
      </p>
      {notice === 'saved' ? (
        <Alert role="status">
          <AlertTitle>Saved. Send a test email below.</AlertTitle>
        </Alert>
      ) : null}
      {notice === 'removed' ? (
        <Alert role="status">
          <AlertTitle>Removed, and its secret forgotten.</AlertTitle>
        </Alert>
      ) : null}
      {rejected ? (
        <Alert variant="destructive">
          <AlertTitle>The settings weren’t saved.</AlertTitle>
          <AlertDescription>
            <ul>
              {rejected.issues.map((issue) => (
                <li>{`${EMAIL_FIELDS[issue.field]}: ${issue.message}`}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      <form method="post" action={urls.admin.saveEmail()} class="email-form">
        <FieldGroup>
          <LabelledField label="Send with" for="email-provider">
            <NativeSelect id="email-provider" name="provider" aria-invalid={invalid('provider')}>
              <option value="ses" selected={form.provider !== 'resend'}>
                Amazon SES
              </option>
              <option value="resend" selected={form.provider === 'resend'}>
                Resend
              </option>
            </NativeSelect>
          </LabelledField>
          {/* Only the chosen provider's fields show (see page.css). */}
          <div class="email-ses">
            <LabelledField
              label="Region"
              for="email-sesRegion"
              hint="Where your SES account sends from, like us-east-1."
            >
              <Input
                id="email-sesRegion"
                name="sesRegion"
                value={form.sesRegion}
                aria-invalid={invalid('sesRegion')}
                aria-describedby={hintId('email-sesRegion')}
                data-on:input={FOLLOW_REGION}
              />
            </LabelledField>
            <TextField
              label="Endpoint"
              name="sesEndpoint"
              id="email-sesEndpoint"
              value={form.sesEndpoint}
              invalid={invalid('sesEndpoint')}
              hint="SES’s address for the region, like https://email.us-east-1.amazonaws.com. It follows the region, unless it’s another address."
            />
            <TextField
              label="Access key ID"
              name="sesAccessKeyId"
              id="email-sesAccessKeyId"
              value={form.sesAccessKeyId}
              invalid={invalid('sesAccessKeyId')}
              hint="An IAM user’s, allowed to send email (ses:SendEmail)."
            />
            {secretField('sesSecretAccessKey', 'That access key’s secret. Sent only to AWS.')}
          </div>
          <div class="email-resend">
            {secretField(
              'resendApiKey',
              'From Resend’s dashboard, with permission to send. Sent only to Resend.',
            )}
          </div>
          <TextField
            label="From name"
            name="fromName"
            id="email-fromName"
            value={form.fromName}
            invalid={invalid('fromName')}
            hint="Optional: the name emails come from, like the site’s title."
          />
          <LabelledField
            label="From"
            for="email-from"
            hint="The address emails come from. Your email service must let you send from its domain."
          >
            <Input
              id="email-from"
              name="from"
              type="email"
              value={form.from}
              aria-invalid={invalid('from')}
              aria-describedby={hintId('email-from')}
            />
          </LabelledField>
          <LabelledField
            label="Reply-to"
            for="email-replyTo"
            hint="Optional: where replies go, if not to the from address."
          >
            <Input
              id="email-replyTo"
              name="replyTo"
              type="email"
              value={form.replyTo}
              aria-invalid={invalid('replyTo')}
              aria-describedby={hintId('email-replyTo')}
            />
          </LabelledField>
          <div class="actions">
            <Button type="submit">Save</Button>
            {status._tag === 'NotSetUp' ? null : (
              <Button type="submit" formaction={urls.admin.removeEmail()} variant="destructive">
                Remove
              </Button>
            )}
          </div>
        </FieldGroup>
      </form>
      {status._tag === 'NotSetUp' && !test ? null : <EmailTry test={test} />}
    </Integration>
  )
}

// Sends an email to any address, with the saved settings, which shows they work.
function EmailTry(props: { test: EmailSectionProps['test'] }): Html {
  let { test } = props
  return (
    <section class="integration-try" aria-labelledby="email-try-heading">
      <h3 id="email-try-heading">Send a test email</h3>
      {test ? <EmailTestResult result={test.result} /> : null}
      <form method="post" action={urls.admin.testEmail()} class="integration-try-form">
        <LabelledField label="To" for="email-test-to">
          <Input
            id="email-test-to"
            name="to"
            type="email"
            value={test?.to ?? ''}
            placeholder="you@example.com"
            aria-invalid={test?.result._tag === 'EmailAddressInvalid' ? 'true' : undefined}
          />
        </LabelledField>
        <Button type="submit" variant="outline">
          Send
        </Button>
      </form>
    </section>
  )
}

function EmailTestResult(props: { result: EmailTest }): Html {
  let { result } = props
  if (result._tag === 'Sent') {
    return (
      <Alert role="status">
        <AlertTitle>{`Sent to ${result.to}. Check its inbox (and spam folder).`}</AlertTitle>
      </Alert>
    )
  }
  return (
    <Alert variant="destructive">
      <AlertTitle>Not sent.</AlertTitle>
      <AlertDescription>{emailFailureMessage(result)}</AlertDescription>
    </Alert>
  )
}

function emailFailureMessage(failure: EmailFailure): string {
  switch (failure._tag) {
    case 'EmailNotSetUp':
      return 'Email isn’t set up: save its settings first.'
    case 'SecretUnreadable':
      return unreadableSecretMessage('secret access key or API key')
    case 'EmailAddressInvalid':
      return 'Enter an email address to send it to, like you@example.com.'
    case 'EmailNotSent':
      return failure.message
  }
}

const SECRET_HINTS = {
  NotSetUp: 'Sent only to Cloudflare, to check the widget’s answers.',
  SecretUnreadable: unreadableSecretMessage('secret key'),
} as const

function TurnstileSection(props: TurnstileSectionProps): Html {
  let { status, notice, rejected, verification } = props
  let invalid = (field: TurnstileIssue['field']) =>
    rejected?.issues.some((issue) => issue.field === field) ? ('true' as const) : undefined
  let siteKey = status._tag === 'NotSetUp' ? '' : status.siteKey
  let enabled = rejected ? rejected.enabled : status._tag !== 'NotSetUp' && status.enabled
  let badge = STATUSES[status._tag]
  return (
    <Integration
      id="turnstile"
      title="Cloudflare Turnstile"
      badge={<Badge variant={badge.variant}>{badge.label}</Badge>}
      // Open on the page that reports what was done, so the report is seen.
      open={notice !== undefined || rejected !== undefined || verification !== undefined}
    >
      <p class="muted">
        Tells people from bots, without a puzzle, on forms anyone can send. Add a widget in{' '}
        <a href="https://dash.cloudflare.com/?to=/:account/turnstile">Cloudflare’s dashboard</a>{' '}
        with this site’s domain as a hostname, then copy its keys here.
      </p>
      {notice === 'saved' ? (
        <Alert role="status">
          <AlertTitle>Saved. Try the widget below.</AlertTitle>
        </Alert>
      ) : null}
      {notice === 'removed' ? (
        <Alert role="status">
          <AlertTitle>Disconnected, and its keys forgotten.</AlertTitle>
        </Alert>
      ) : null}
      {rejected ? (
        <Alert variant="destructive">
          <AlertTitle>The keys weren’t saved.</AlertTitle>
          <AlertDescription>
            <ul>
              {rejected.issues.map((issue) => (
                <li>{`${issue.field === 'siteKey' ? 'Site key' : 'Secret key'}: ${issue.message}`}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      <form method="post" action={urls.admin.saveTurnstile()}>
        <FieldGroup>
          <TextField
            label="Site key"
            name="siteKey"
            id="turnstile-siteKey"
            value={rejected?.siteKey ?? siteKey}
            invalid={invalid('siteKey')}
            hint="Public: pages show it to load the widget."
          />
          <LabelledField
            label="Secret key"
            for="turnstile-secretKey"
            hint={
              status._tag === 'SetUp'
                ? 'Leave it empty to keep the saved one.'
                : SECRET_HINTS[status._tag]
            }
          >
            {/* The saved one, masked: only its last characters are sent to the browser. */}
            <Input
              id="turnstile-secretKey"
              name="secretKey"
              type="password"
              autocomplete="off"
              placeholder={
                status._tag === 'SetUp' ? `${'•'.repeat(12)}${status.secretKeyEnding}` : undefined
              }
              aria-invalid={invalid('secretKey')}
              aria-describedby={hintId('turnstile-secretKey')}
            />
          </LabelledField>
          <Field orientation="horizontal">
            <Checkbox
              id="turnstile-enabled"
              name="enabled"
              checked={enabled}
              aria-describedby="turnstile-enabled-description"
            />
            <FieldContent>
              <FieldLabel for="turnstile-enabled">Enabled</FieldLabel>
              <FieldDescription id="turnstile-enabled-description">
                Logging in requires passing it. If it ever locks you out, run{' '}
                <code>logspace turnstile off</code> on the server.
              </FieldDescription>
            </FieldContent>
          </Field>
          <div class="actions">
            <Button type="submit">Save</Button>
            {status._tag === 'NotSetUp' ? null : (
              <Button type="submit" formaction={urls.admin.removeTurnstile()} variant="destructive">
                Disconnect
              </Button>
            )}
          </div>
        </FieldGroup>
      </form>
      {status._tag === 'NotSetUp' ? (
        // Disconnected since the page with the widget was shown.
        verification ? (
          <VerificationResult verification={verification} />
        ) : null
      ) : (
        <TurnstileTry siteKey={status.siteKey} verification={verification} />
      )}
    </Integration>
  )
}

// A service's name and status, which open to its settings, with a line above to set it apart from
// the one before (the page closes the last with another).
function Integration(props: {
  id: string
  title: string
  badge: Html
  open: boolean
  children: Child
}): Html {
  let { id, title, badge, open, children } = props
  return (
    <>
      <Separator />
      <details open={open}>
        <summary class="integration-summary">
          <h2 id={`${id}-heading`}>{title}</h2>
          {badge}
          <CaretDownIcon class="integration-caret" />
        </summary>
        <section class="integration-body" aria-labelledby={`${id}-heading`}>
          {children}
        </section>
      </details>
    </>
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
    <section class="integration-try" aria-labelledby="turnstile-try-heading">
      <h3 id="turnstile-try-heading">Try it</h3>
      <p class="muted">
        Complete the challenge, then verify its answer with Cloudflare. If the widget shows an error
        instead, check that this site’s domain is one of its hostnames on Cloudflare.
      </p>
      {verification ? <VerificationResult verification={verification} /> : null}
      <form method="post" action={urls.admin.verifyTurnstile()} class="integration-try-form">
        <TurnstileWidget siteKey={siteKey} />
        <Button type="submit" variant="outline">
          Verify
        </Button>
      </form>
    </section>
  )
}

function VerificationResult(props: { verification: TurnstileVerification }): Html {
  let { verification } = props
  if (verification._tag === 'Verified') {
    return (
      <Alert role="status">
        <AlertTitle>
          Verified: Cloudflare accepted the answer
          {verification.hostname ? `, solved on ${verification.hostname}` : ''}. Turnstile works.
        </AlertTitle>
      </Alert>
    )
  }
  return (
    <Alert variant="destructive">
      <AlertTitle>Not verified.</AlertTitle>
      <AlertDescription>{failureMessage(verification)}</AlertDescription>
    </Alert>
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
      return unreadableSecretMessage('secret key')
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
