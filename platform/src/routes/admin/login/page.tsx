import type { Html } from '#jsx/jsx-runtime'

import { stylesheet } from '../../../components/stylesheet.ts'
import { Button } from '../../../components/ui/button.tsx'
import { Field, FIELD_STYLES, FieldError, FieldLabel } from '../../../components/ui/field.tsx'
import { Input, INPUT_STYLES } from '../../../components/ui/input.tsx'
import { urls } from '../../../lib/urls.ts'
import css from './page.css' with { type: 'text' }

export const LOGIN_PAGE_STYLES = FIELD_STYLES + INPUT_STYLES + stylesheet(css)

export function LoginPage(props: { error?: string | undefined; enabled: boolean }): Html {
  let { error, enabled } = props
  return (
    <section class="admin-page">
      <h1 class="page-title">Manage Site</h1>
      {enabled ? (
        <form method="post" action={urls.admin.login()} class="login-form">
          <Field invalid={error !== undefined}>
            <FieldLabel for="password">Admin Password</FieldLabel>
            <Input
              id="password"
              name="password"
              type="password"
              autocomplete="current-password"
              required
              autofocus
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? 'password-error' : undefined}
            />
            {error ? <FieldError id="password-error">{error}</FieldError> : null}
          </Field>
          <Button type="submit">Log in</Button>
        </form>
      ) : (
        <p>
          Managing the site is switched off. Set <code>ADMIN_PASSWORD</code> and{' '}
          <code>AUTH_SESSION_SECRET</code> (each at least 16 characters) and restart the server.
        </p>
      )}
    </section>
  )
}
