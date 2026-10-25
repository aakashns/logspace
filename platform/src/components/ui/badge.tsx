// shadcn/ui's Badge, in its base-nova style: a <span>, or a link when it has an href.
import type { Child, Html } from '#jsx/jsx-runtime'

import { stylesheet } from '../stylesheet.ts'
import css from './badge.css' with { type: 'text' }

export const BADGE_STYLES = stylesheet(css)

export function Badge(
  props: Record<string, unknown> & {
    variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link' | undefined
    href?: string | undefined
    children?: Child
  },
): Html {
  let { variant = 'default', children, ...attributes } = props
  let slot = { 'data-slot': 'badge', 'data-variant': variant }
  if (attributes.href !== undefined) {
    return (
      <a {...slot} {...attributes}>
        {children}
      </a>
    )
  }
  return (
    <span {...slot} {...attributes}>
      {children}
    </span>
  )
}
