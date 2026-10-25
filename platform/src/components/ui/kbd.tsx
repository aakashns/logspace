// shadcn/ui's Kbd, in its base-nova style: a key, or with KbdGroup, keys pressed together.
import type { Child, Html } from '#jsx/jsx-runtime'

import { stylesheet } from '../stylesheet.ts'
import css from './kbd.css' with { type: 'text' }

export const KBD_STYLES = stylesheet(css)

type Props = Record<string, unknown> & { children?: Child }

export function Kbd(props: Props): Html {
  let { children, ...attributes } = props
  return (
    <kbd data-slot="kbd" {...attributes}>
      {children}
    </kbd>
  )
}

export function KbdGroup(props: Props): Html {
  let { children, ...attributes } = props
  return (
    <kbd data-slot="kbd-group" {...attributes}>
      {children}
    </kbd>
  )
}
