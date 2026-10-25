import type { Child, Html } from '#jsx/jsx-runtime'

import { LogoutButton } from '../../components/controls.tsx'
import { Document, type PageContext } from '../../components/document.tsx'
import { stylesheet } from '../../components/stylesheet.ts'
import { urls } from '../../lib/urls.ts'
import css from './layout.css' with { type: 'text' }

const ADMIN_STYLES = stylesheet(css)

// An admin page: kept out of search results, with the admin styles and then its own, and a logout
// button in the navbar once logged in.
export function AdminPage(props: {
  page: PageContext
  path: string
  title: string
  styles: string
  loggedIn?: boolean | undefined
  children: Child
}): Html {
  let { page, path, title, styles, loggedIn = true, children } = props
  return (
    <Document
      page={page}
      meta={{ path, title, noindex: true }}
      styles={ADMIN_STYLES + styles}
      navActions={loggedIn ? <LogoutButton /> : null}
    >
      {children}
    </Document>
  )
}

// An admin page that only says something, like why a request failed.
export function AdminMessage(props: { title: string; children: Child }): Html {
  return (
    <section class="admin-page">
      <h1 class="page-title">{props.title}</h1>
      <p>{props.children}</p>
    </section>
  )
}

// The link back to /admin, above the title of the page of one of its parts.
export function BackLink(): Html {
  return (
    <a href={urls.admin.index()} class="muted back-link">
      ← Manage Site
    </a>
  )
}
