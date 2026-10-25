import type { Html } from '#jsx/jsx-runtime'

import { LINK_CARDS_STYLES, LinkCards } from '../../../components/link-cards.tsx'
import { stylesheet } from '../../../components/stylesheet.ts'
import { urls } from '../../../lib/urls.ts'
import css from './page.css' with { type: 'text' }

export const DEV_INDEX_STYLES = LINK_CARDS_STYLES + stylesheet(css)

// /dev: a card linking to each tool for working on the app.
export function DevIndexPage(): Html {
  return (
    <section class="dev-index">
      <h1 class="page-title">Development</h1>
      <p class="dev-intro">Tools for working on LogSpace. Only served outside production.</p>
      <LinkCards
        links={[
          {
            href: urls.dev.design(),
            title: 'Design',
            text: 'Every component in components/ui, in the light and dark themes.',
          },
          {
            href: urls.dev.emails(),
            title: 'Emails',
            text: 'What the site sent with its fake of Amazon SES, and how to set it up.',
          },
        ]}
      />
    </section>
  )
}
