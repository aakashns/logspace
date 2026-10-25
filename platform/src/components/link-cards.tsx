// A grid of cards that are each a link to a page, with its title and what's there, as /admin and
// /dev lead to theirs.
import type { Html } from '#jsx/jsx-runtime'

import { stylesheet } from './stylesheet.ts'
import { Card, CARD_STYLES, CardDescription, CardHeader, CardTitle } from './ui/card.tsx'
import css from './link-cards.css' with { type: 'text' }

export const LINK_CARDS_STYLES = CARD_STYLES + stylesheet(css)

export function LinkCards(props: {
  links: readonly { href: string; title: string; text: string }[]
}): Html {
  return (
    <ul class="link-cards">
      {props.links.map((link) => (
        <li>
          <a href={link.href} class="link-card">
            <Card>
              <CardHeader>
                <CardTitle as="h2">{link.title}</CardTitle>
                <CardDescription>{link.text}</CardDescription>
              </CardHeader>
            </Card>
          </a>
        </li>
      ))}
    </ul>
  )
}
