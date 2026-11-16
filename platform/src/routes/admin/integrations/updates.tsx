import type { Html } from '#jsx/jsx-runtime'
import { ConfigSection } from '../config-section.tsx'
import { Badge } from '../../../components/ui/badge.tsx'
import { Separator } from '../../../components/ui/separator.tsx'
import { Alert, AlertTitle, AlertDescription } from '../../../components/ui/alert.tsx'
import { Button } from '../../../components/ui/button.tsx'
import { Checkbox } from '../../../components/ui/checkbox.tsx'
import {
  Field,
  FieldLabel,
  FieldContent,
  FieldDescription,
  FieldGroup,
} from '../../../components/ui/field.tsx'
import type { UpdateStatus } from '../../../lib/updates.ts'
import { compareVersions } from '../../../lib/version.ts'
import { urls } from '../../../lib/urls.ts'

export function UpdateSection({
  status,
  error,
}: {
  status: UpdateStatus
  error?: string | undefined
}): Html {
  let busy =
    status.pending || status.result?.state === 'checking' || status.result?.state === 'updating'
  let available = status.latest && compareVersions(status.latest, status.current) > 0
  let failed = Boolean(error || status.error || status.result?.state === 'error')
  let label = busy
    ? 'Updating…'
    : failed
      ? 'Needs attention'
      : available
        ? 'Update available'
        : status.latest
          ? 'Up to date'
          : 'Manual updates'
  // A restart may drop any request. Polling reads durable state; never replay mutations.
  return (
    <section
      id="software-updates"
      {...(status.managed
        ? {
            'data-on-interval__duration.5s':
              '@get(el.dataset.statusUrl, {retryMaxCount: 0}).catch(() => {})',
          }
        : {})}
      data-status-url={urls.admin.updateStatus()}
    >
      <ConfigSection
        id="updates"
        title="Updates"
        badge={
          <Badge variant={failed ? 'destructive' : available || busy ? 'default' : 'secondary'}>
            {label}
          </Badge>
        }
        open
        preserveOpen
      >
        <p class="muted">
          Running LogSpace <strong>{status.current}</strong>.
        </p>
        <p role="status" aria-live="polite">
          {busy
            ? status.pending
              ? 'Update requested. Waiting for the update service…'
              : status.result?.message
            : available
              ? `LogSpace ${status.latest} is available.`
              : status.latest
                ? 'You’re on the latest version.'
                : (status.error ?? 'Release checks are available on managed installations.')}
        </p>
        {status.result && !busy ? (
          status.result.state === 'error' ? (
            <Alert variant="destructive">
              <AlertTitle>Update failed.</AlertTitle>
              <AlertDescription>{status.result.message}</AlertDescription>
            </Alert>
          ) : (
            <p class="muted">{status.result.message}</p>
          )
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>The update settings weren’t changed.</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {status.managed ? (
          <>
            <form
              method="post"
              action={urls.admin.autoUpdates()}
              data-on:submit={
                "@post(el.action, {contentType: 'form', retryMaxCount: 0}).catch(() => {})"
              }
            >
              <FieldGroup>
                <Field orientation="horizontal">
                  <Checkbox
                    id="auto-updates"
                    name="enabled"
                    checked={status.enabled}
                    aria-describedby="auto-updates-description"
                  />
                  <FieldContent>
                    <FieldLabel for="auto-updates">Enable automatic updates</FieldLabel>
                    <FieldDescription id="auto-updates-description">
                      Check once a day and install new releases automatically. Updates briefly
                      restart the service.
                    </FieldDescription>
                  </FieldContent>
                </Field>
                <div class="actions">
                  <Button type="submit">Save update preference</Button>
                </div>
              </FieldGroup>
            </form>
            {available || busy ? (
              <form
                method="post"
                action={urls.admin.updateNow()}
                data-on:submit={
                  "@post(el.action, {contentType: 'form', retryMaxCount: 0}).catch(() => {})"
                }
              >
                <Button type="submit" disabled={Boolean(busy)}>
                  {busy ? 'Updating…' : 'Update now'}
                </Button>
              </form>
            ) : null}
          </>
        ) : (
          <p class="muted">
            Run <code>sudo logspace deploy</code> with this version to enable managed updates.
          </p>
        )}
      </ConfigSection>
      <Separator />
    </section>
  )
}
