import type { Html } from '#jsx/jsx-runtime'

import { stylesheet } from '../../../components/stylesheet.ts'
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

// /dev/emails: how to send to the site's fake of Amazon SES, and what it took, newest first.
export function DevEmailsPage(props: {
  emails: readonly ReceivedEmail[]
  example: { accessKeyId: string; secretAccessKey: string }
}): Html {
  let { emails, example } = props
  return (
    <section class="dev-emails">
      <h1 class="page-title">Emails</h1>
      <p class="dev-emails-intro">
        What the site sent with its fake of Amazon SES, which checks each request as SES would. To
        send to it, set up email at <a href={urls.admin.integrations()}>Integrations</a> with Amazon
        SES, any region, AWS’s example access key ID <code>{example.accessKeyId}</code>, and its
        secret access key <code>{example.secretAccessKey}</code>. They’re kept until the server
        stops.
      </p>
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
