import { routes } from '../routes.ts'
import { navButtonStyle } from './public/nav-button.ts'
import { Tooltip } from './public/tooltip.tsx'

// The navbar's link to the RSS feed. The browser opens it rather than Remix's client-side
// navigation, which would try to render the XML as a page.
export function RssLink() {
  return () => (
    <Tooltip label="RSS feed">
      <a href={routes.rss.href()} aria-label="RSS feed" data-rmx-document mix={navButtonStyle}>
        <RssIcon />
      </a>
    </Tooltip>
  )
}

// A dot with two arcs spreading from it.
function RssIcon() {
  return () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 4.5A14.5 14.5 0 0 1 19.5 19M5 10.5A8.5 8.5 0 0 1 13.5 19"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
      <circle cx="6" cy="18" r="1.5" fill="currentColor" />
    </svg>
  )
}
