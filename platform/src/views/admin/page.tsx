import type { Child, Html } from '#jsx/jsx-runtime'

import { LogoutButton } from '../controls.tsx'
import { Document, type PageContext } from '../document.tsx'

// An admin page: kept out of search results, with the admin styles, and a logout button in the
// navbar once logged in.
export function AdminPage(props: {
  page: PageContext
  path: string
  title: string
  loggedIn?: boolean
  children: Child
}): Html {
  let { page, path, title, loggedIn = true, children } = props
  return (
    <Document
      page={page}
      meta={{ path, title, noindex: true }}
      navActions={loggedIn ? <LogoutButton /> : null}
      admin
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
