// shadcn/ui's Button, in its base-nova style: a <button> (type="button" unless it says otherwise),
// or a link that looks like one when it has an href. Any other attribute goes on the element as
// it is, like `type`, `form`, or a Datastar `data-on:click`. A disabled link has no href, so
// neither a click nor Enter can follow it, and says it's disabled with aria-disabled.
import type { Child, Html } from '#jsx/jsx-runtime'

import { stylesheet } from '../stylesheet.ts'
import css from './button.css' with { type: 'text' }

export const BUTTON_STYLES = stylesheet(css)

export type ButtonProps = Record<string, unknown> & {
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link' | undefined
  size?: 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg' | undefined
  href?: string | undefined
  disabled?: boolean | undefined
  children?: Child
}

export function Button(props: ButtonProps): Html {
  let { variant = 'default', size = 'default', href, disabled, children, ...attributes } = props
  let slot = { 'data-slot': 'button', 'data-variant': variant, 'data-size': size }
  if (href !== undefined) {
    let link = disabled ? { role: 'link', 'aria-disabled': 'true' } : { href }
    return (
      <a {...slot} {...link} {...attributes}>
        {children}
      </a>
    )
  }
  return (
    <button type="button" disabled={disabled} {...slot} {...attributes}>
      {children}
    </button>
  )
}
