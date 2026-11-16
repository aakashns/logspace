import type { Html } from '#jsx/jsx-runtime'
import { Button } from '../../../components/ui/button.tsx'
import { Checkbox } from '../../../components/ui/checkbox.tsx'
import { Field, FieldLabel } from '../../../components/ui/field.tsx'
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
  // A restart may drop any request. Polling reads durable state; never replay mutations.
  return (
    <section
      id="software-updates"
      class="update-section"
      {...(status.managed
        ? {
            'data-on-interval__duration.5s':
              '@get(el.dataset.statusUrl, {retryMaxCount: 0}).catch(() => {})',
          }
        : {})}
      data-status-url={urls.admin.updateStatus()}
    >
      <h2>Updates</h2>
      <p>
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
      {status.result && !busy ? <p>{status.result.message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {status.managed ? (
        <>
          <form
            method="post"
            action={urls.admin.autoUpdates()}
            data-on:submit={
              "@post(el.action, {contentType: 'form', retryMaxCount: 0}).catch(() => {})"
            }
          >
            <Field orientation="horizontal">
              <Checkbox id="auto-updates" name="enabled" checked={status.enabled} />
              <FieldLabel for="auto-updates">Enable automatic updates</FieldLabel>
            </Field>
            <p>
              Check once a day and install new releases automatically. Updates briefly restart the
              service.
            </p>
            <Button type="submit" variant="outline">
              Save update preference
            </Button>
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
        <p>
          Run <code>sudo logspace deploy</code> with this version to enable managed updates.
        </p>
      )}
    </section>
  )
}
