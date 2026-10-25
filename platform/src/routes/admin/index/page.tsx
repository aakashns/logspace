import type { Html } from '#jsx/jsx-runtime'

import { stylesheet } from '../../../components/stylesheet.ts'
import type { SiteConfig } from '../../../data/site/site.ts'
import { urls } from '../../../lib/urls.ts'
import css from './page.css' with { type: 'text' }

export const ADMIN_INDEX_STYLES = stylesheet(css)

// /admin: a card for each part of the admin, with what it holds now.
export function AdminIndexPage(props: { postCount: number; site: SiteConfig }): Html {
  let { postCount, site } = props
  return (
    <section class="admin-page">
      <h1 class="page-title">Manage Site</h1>
      <ul class="admin-cards">
        <AdminCard
          href={urls.admin.posts()}
          title="Manage Posts"
          text="Write new posts, and edit or delete published ones."
          status={postCount === 1 ? '1 post' : `${postCount} posts`}
        />
        <AdminCard
          href={urls.admin.branding()}
          title="Branding"
          text="The site’s title, URL, home page introduction, logos, icon, and banner image."
          status={site.siteTitle}
        />
        <AdminCard
          href={urls.admin.integrations()}
          title="Integrations"
          text="Services the site connects to, like Cloudflare Turnstile."
          status={site.turnstile ? 'Turnstile connected' : 'None connected'}
        />
        <AdminCard
          href={urls.admin.subscribers()}
          title="Subscribers"
          text="People who follow the site by email."
          status="Coming soon"
        />
      </ul>
    </section>
  )
}

function AdminCard(props: { href: string; title: string; text: string; status: string }): Html {
  return (
    <li>
      <a href={props.href} class="admin-card">
        <h2>{props.title}</h2>
        <p class="muted">{props.text}</p>
        <p class="admin-card-status" data-ignore>
          {props.status}
        </p>
      </a>
    </li>
  )
}
