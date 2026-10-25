import type { Html } from '#jsx/jsx-runtime'

import { BackLink } from '../layout.tsx'

// /admin/subscribers.
export function SubscribersPage(): Html {
  return (
    <section class="admin-page">
      <BackLink />
      <h1 class="page-title">Subscribers</h1>
      <p class="muted">No subscribers yet.</p>
    </section>
  )
}
