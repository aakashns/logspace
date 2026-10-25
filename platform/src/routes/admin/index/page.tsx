import type { Html } from '#jsx/jsx-runtime'

import { stylesheet } from '../../../components/stylesheet.ts'
import {
  Card,
  CARD_STYLES,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card.tsx'
import { urls } from '../../../lib/urls.ts'
import css from './page.css' with { type: 'text' }

export const ADMIN_INDEX_STYLES = CARD_STYLES + stylesheet(css)

// /admin: a card linking to each part of the admin.
export function AdminIndexPage(): Html {
  return (
    <section class="admin-page">
      <h1 class="page-title">Manage Site</h1>
      <ul class="admin-links">
        <AdminLink
          href={urls.admin.posts()}
          title="Manage Posts"
          text="Write new posts, and edit or delete published ones."
        />
        <AdminLink
          href={urls.admin.branding()}
          title="Branding"
          text="The site’s title, URL, home page introduction, logos, icon, and banner image."
        />
        <AdminLink
          href={urls.admin.integrations()}
          title="Integrations"
          text="Services the site connects to: email, and Cloudflare Turnstile."
        />
        <AdminLink
          href={urls.admin.subscribers()}
          title="Subscribers"
          text="People who follow the site by email."
        />
      </ul>
    </section>
  )
}

function AdminLink(props: { href: string; title: string; text: string }): Html {
  return (
    <li>
      <a href={props.href} class="admin-link">
        <Card>
          <CardHeader>
            <CardTitle as="h2">{props.title}</CardTitle>
            <CardDescription>{props.text}</CardDescription>
          </CardHeader>
        </Card>
      </a>
    </li>
  )
}
