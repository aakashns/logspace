import type { Html } from '#jsx/jsx-runtime'

import { stylesheet } from '../../../components/stylesheet.ts'
import { Button } from '../../../components/ui/button.tsx'
import {
  Card,
  CARD_STYLES,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card.tsx'
import { urls } from '../../../lib/urls.ts'
import type { ReceivedEmail } from './inbox.ts'
import css from './page.css' with { type: 'text' }

export const DEV_EMAILS_STYLES = CARD_STYLES + stylesheet(css)

// Copies the button's value, and says so on the button until another is copied. The `_copied`
// signal (declared on the list) holds the value copied last.
const COPY =
  'navigator.clipboard.writeText(el.dataset.value).then(() => ($_copied = el.dataset.value))'
const COPY_LABEL = "$_copied === el.dataset.value ? 'Copied' : 'Copy'"

// /dev/emails: the settings that send to the site's fake of Amazon SES, each with a button that
// copies it, and what the fake took, newest first.
export function DevEmailsPage(props: {
  settings: readonly { label: string; value: string }[]
  emails: readonly ReceivedEmail[]
}): Html {
  let { settings, emails } = props
  return (
    <section class="dev-emails">
      <h1 class="page-title">Emails</h1>
      <p class="dev-emails-intro">
        What the site sent to its fake of Amazon SES, which checks each request as SES would. To
        send to it, set up email at <a href={urls.admin.integrations()}>Integrations</a> with Amazon
        SES and these settings. Emails are kept until the server stops.
      </p>
      <dl class="dev-emails-settings" data-signals="{_copied: ''}">
        {settings.map(({ label, value }) => (
          <>
            <dt>{label}</dt>
            <dd>
              <code>{value}</code>
              <Button
                type="button"
                variant="outline"
                size="xs"
                data-value={value}
                data-on:click={COPY}
                data-text={COPY_LABEL}
              >
                Copy
              </Button>
            </dd>
          </>
        ))}
      </dl>
      {emails.length === 0 ? (
        <p class="dev-emails-intro">None yet.</p>
      ) : (
        // What's in them was typed by someone: Datastar mustn't read it.
        <ol class="dev-emails-list" data-ignore>
          {emails.map((email) => (
            <li>
              <Card>
                <CardHeader>
                  <CardTitle as="h2">{email.subject}</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl class="dev-email-headers">
                    <dt>From</dt>
                    <dd>{email.from}</dd>
                    <dt>To</dt>
                    <dd>{email.to.join(', ')}</dd>
                    {email.replyTo.length > 0 ? (
                      <>
                        <dt>Reply-To</dt>
                        <dd>{email.replyTo.join(', ')}</dd>
                      </>
                    ) : null}
                    <dt>Received</dt>
                    <dd>
                      <time datetime={email.receivedAt.toISOString()}>
                        {email.receivedAt.toISOString()}
                      </time>
                    </dd>
                  </dl>
                  <pre class="dev-email-text">{email.text}</pre>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
