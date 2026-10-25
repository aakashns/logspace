// shadcn/ui's Alert, in its base-nova style: a box with a title and description, and an optional
// icon first. It has the alert role, as in shadcn, which screen readers read out when it appears;
// give one that's always on the page role="status" or role="note" instead.
import type { Child, Html } from '#jsx/jsx-runtime'

import { stylesheet } from '../stylesheet.ts'
import css from './alert.css' with { type: 'text' }

export const ALERT_STYLES = stylesheet(css)

type Props = Record<string, unknown> & { children?: Child }

export function Alert(props: Props & { variant?: 'default' | 'destructive' | undefined }): Html {
  let { variant = 'default', children, ...attributes } = props
  return (
    <div data-slot="alert" data-variant={variant} role="alert" {...attributes}>
      {children}
    </div>
  )
}

export function AlertTitle(props: Props): Html {
  let { children, ...attributes } = props
  return (
    <div data-slot="alert-title" {...attributes}>
      {children}
    </div>
  )
}

export function AlertDescription(props: Props): Html {
  let { children, ...attributes } = props
  return (
    <div data-slot="alert-description" {...attributes}>
      {children}
    </div>
  )
}
