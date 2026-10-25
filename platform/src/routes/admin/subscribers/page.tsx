import type { Html } from '#jsx/jsx-runtime'

import { stylesheet } from '../../../components/stylesheet.ts'
import { Alert, ALERT_STYLES, AlertDescription, AlertTitle } from '../../../components/ui/alert.tsx'
import { Button } from '../../../components/ui/button.tsx'
import {
  Field,
  FieldContent,
  FieldDescription,
  FIELD_STYLES,
  FieldLabel,
} from '../../../components/ui/field.tsx'
import { Switch, SWITCH_STYLES } from '../../../components/ui/switch.tsx'
import type { SubscriptionsBlocker, SubscriptionsStatus } from '../../../data/site/subscriptions.ts'
import { urls } from '../../../lib/urls.ts'
import { BackLink } from '../layout.tsx'
import css from './page.css' with { type: 'text' }

export const SUBSCRIBERS_PAGE_STYLES = FIELD_STYLES + SWITCH_STYLES + ALERT_STYLES + stylesheet(css)

const BLOCKERS: Record<SubscriptionsBlocker, string> = {
  EmailNotSetUp: 'Email isn’t set up.',
  EmailSecretUnreadable: 'Email’s saved secret can’t be read. Enter it again.',
  TurnstileNotSetUp: 'Cloudflare Turnstile isn’t set up.',
  TurnstileSecretUnreadable:
    'Cloudflare Turnstile’s saved secret key can’t be read. Enter it again.',
  TurnstileNotEnabled: 'Cloudflare Turnstile isn’t enabled.',
}

// /admin/subscribers: the switch for subscribing, and while it can't be switched on, or is on but
// paused, why.
export function SubscribersPage(props: { status: SubscriptionsStatus }): Html {
  let { status } = props
  let missing = status._tag === 'Open' ? [] : status.missing
  // It can always be switched off, but on only once nothing's missing.
  let locked = status._tag === 'Off' && missing.length > 0
  return (
    <section class="admin-page">
      <BackLink />
      <h1 class="page-title">Subscribers</h1>
      <form method="post" action={urls.admin.subscribers()} class="subscriptions-form">
        <Field orientation="horizontal" disabled={locked}>
          <FieldContent>
            <FieldLabel for="subscriptions-enabled">Enable subscriptions</FieldLabel>
            <FieldDescription id="subscriptions-enabled-description">
              The home page shows a Subscribe button. Subscribing makes an account, once the address
              is confirmed with a code sent to it.
            </FieldDescription>
          </FieldContent>
          {/* Changing it saves it. Without JavaScript, the Save button below does. */}
          <Switch
            id="subscriptions-enabled"
            name="enabled"
            checked={status._tag !== 'Off'}
            disabled={locked}
            aria-describedby="subscriptions-enabled-description"
            data-on:change="el.form.requestSubmit()"
          />
        </Field>
        <noscript>
          <Button type="submit" variant="outline" disabled={locked}>
            Save
          </Button>
        </noscript>
      </form>
      {missing.length > 0 ? (
        <Alert variant={status._tag === 'Paused' ? 'destructive' : 'default'}>
          <AlertTitle>
            {status._tag === 'Paused'
              ? 'Subscribing is paused, and the home page doesn’t show the Subscribe button.'
              : 'Subscriptions need email set up and Cloudflare Turnstile enabled.'}
          </AlertTitle>
          <AlertDescription>
            <ul>
              {missing.map((blocker) => (
                <li>{BLOCKERS[blocker]}</li>
              ))}
            </ul>
            <p>
              Set them up in <a href={urls.admin.integrations()}>Integrations</a>.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  )
}
