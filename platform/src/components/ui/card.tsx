// shadcn/ui's Card, in its base-nova style. CardTitle is a <div> as in shadcn; give it
// `as="h2"` (or h3, h4) where the card starts a section, so it's in the page's outline.
import type { Child, Html } from '#jsx/jsx-runtime'

import { stylesheet } from '../stylesheet.ts'
import css from './card.css' with { type: 'text' }

export const CARD_STYLES = stylesheet(css)

type Props = Record<string, unknown> & { children?: Child }

export function Card(props: Props & { size?: 'default' | 'sm' | undefined }): Html {
  let { size = 'default', children, ...attributes } = props
  return (
    <div data-slot="card" data-size={size} {...attributes}>
      {children}
    </div>
  )
}

export function CardHeader(props: Props): Html {
  let { children, ...attributes } = props
  return (
    <div data-slot="card-header" {...attributes}>
      {children}
    </div>
  )
}

export function CardTitle(props: Props & { as?: 'div' | 'h2' | 'h3' | 'h4' | undefined }): Html {
  let { as: Tag = 'div', children, ...attributes } = props
  return (
    <Tag data-slot="card-title" {...attributes}>
      {children}
    </Tag>
  )
}

export function CardDescription(props: Props): Html {
  let { children, ...attributes } = props
  return (
    <div data-slot="card-description" {...attributes}>
      {children}
    </div>
  )
}

// A button or link at the header's top right, beside the title and description.
export function CardAction(props: Props): Html {
  let { children, ...attributes } = props
  return (
    <div data-slot="card-action" {...attributes}>
      {children}
    </div>
  )
}

export function CardContent(props: Props): Html {
  let { children, ...attributes } = props
  return (
    <div data-slot="card-content" {...attributes}>
      {children}
    </div>
  )
}

export function CardFooter(props: Props): Html {
  let { children, ...attributes } = props
  return (
    <div data-slot="card-footer" {...attributes}>
      {children}
    </div>
  )
}
