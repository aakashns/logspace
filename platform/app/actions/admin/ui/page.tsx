import type { RemixNode } from 'remix/component'

import { getTheme } from '../../../lib/theme.ts'
import { routes } from '../../../routes.ts'
import { navButtonStyle } from '../../../ui/public/nav-button.ts'
import { Tooltip } from '../../../ui/public/tooltip.tsx'
import { Document } from '../../document.tsx'
import { pageStyle, titleStyle } from './styles.ts'

// An admin page, for context.render: kept out of search results, with a logout button in the
// navbar once logged in.
export function renderAdminPage(
  request: Request,
  title: string,
  page: RemixNode,
  init?: ResponseInit,
  { loggedIn = true } = {},
): [RemixNode, ResponseInit | undefined] {
  let meta = { path: new URL(request.url).pathname, title, noindex: true }
  let navActions = loggedIn ? <AdminLogoutButton /> : undefined
  return [
    <Document theme={getTheme(request)} meta={meta} navActions={navActions}>
      {page}
    </Document>,
    init,
  ]
}

// An admin page that only says something, like why a request failed.
export function renderAdminMessage(
  request: Request,
  title: string,
  message: RemixNode,
  init?: ResponseInit,
) {
  let page = (
    <section mix={pageStyle}>
      <h1 mix={titleStyle}>{title}</h1>
      <p>{message}</p>
    </section>
  )
  return renderAdminPage(request, title, page, init)
}

function AdminLogoutButton() {
  return () => (
    <form method="post" action={routes.admin.logout.href()}>
      <Tooltip label="Log out">
        <button type="submit" aria-label="Log out" mix={navButtonStyle}>
          <LogoutIcon />
        </button>
      </Tooltip>
    </form>
  )
}

// An arrow leaving a door frame.
function LogoutIcon() {
  return () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M9.5 20.5H5.5A1.5 1.5 0 0 1 4 19V5A1.5 1.5 0 0 1 5.5 3.5H9.5M15.5 16.5L20 12L15.5 7.5M20 12H9"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}
