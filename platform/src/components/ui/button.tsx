// shadcn/ui's Button, in its base-nova style: a <button> (type="button" unless it says otherwise),
// or a link that looks like one when it has an href. Any other attribute goes on the element as
// it is, like `type`, `disabled`, `form`, or a Datastar `data-on:click`.
import type { Child, Html } from '#jsx/jsx-runtime'

import { stylesheet } from '../stylesheet.ts'
import css from './button.css' with { type: 'text' }

export const BUTTON_STYLES = stylesheet(css)

export type ButtonProps = Record<string, unknown> & {
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link' | undefined
  size?: 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg' | undefined
  href?: string | undefined
  children?: Child
}

export function Button(props: ButtonProps): Html {
  let { variant = 'default', size = 'default', children, ...attributes } = props
  let slot = { 'data-slot': 'button', 'data-variant': variant, 'data-size': size }
  if (attributes.href !== undefined) {
    return (
      <a {...slot} {...attributes}>
        {children}
      </a>
    )
  }
  return (
    <button type="button" {...slot} {...attributes}>
      {children}
    </button>
  )
}
