import type { Html } from '#jsx/jsx-runtime'

import { LINK_CARDS_STYLES, LinkCards } from '../../../components/link-cards.tsx'
import { urls } from '../../../lib/urls.ts'

export const ADMIN_INDEX_STYLES = LINK_CARDS_STYLES

// /admin: a card linking to each part of the admin.
export function AdminIndexPage(): Html {
  return (
    <section class="admin-page">
      <h1 class="page-title">Manage Site</h1>
      <LinkCards
        links={[
          {
            href: urls.admin.posts(),
            title: 'Manage Posts',
            text: 'Write new posts, and edit or delete published ones.',
          },
          {
            href: urls.admin.branding(),
            title: 'Branding',
            text: 'The site’s title, URL, home page introduction, logos, icon, and banner image.',
          },
          {
            href: urls.admin.integrations(),
            title: 'Integrations',
            text: 'Services the site connects to: Cloudflare Turnstile, and email.',
          },
          {
            href: urls.admin.subscribers(),
            title: 'Subscribers',
            text: 'People who follow the site by email.',
          },
        ]}
      />
    </section>
  )
}
