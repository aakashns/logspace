import type { Html } from '#jsx/jsx-runtime'

import { urls } from '../../../lib/urls.ts'

export function LoginPage(props: { error?: string | undefined; enabled: boolean }): Html {
  let { error, enabled } = props
  return (
    <section class="admin-page">
      <h1 class="page-title">Manage Site</h1>
      {enabled ? (
        <form method="post" action={urls.admin.login()} class="login-form">
          <label for="password">Admin Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autocomplete="current-password"
            required
            autofocus
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? 'password-error' : undefined}
            class="input"
          />
          {error ? (
            <p id="password-error" role="alert" class="error">
              {error}
            </p>
          ) : null}
          <button type="submit" class="button">
            Log in
          </button>
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
