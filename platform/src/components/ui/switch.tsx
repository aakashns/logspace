// shadcn/ui's Switch, in its base-nova style. It's a native checkbox with the switch role, so
// screen readers call it on or off, it's sent with its form, and it works without JavaScript.
// Its attributes go on the <input>.
import type { Html } from '#jsx/jsx-runtime'

import { stylesheet } from '../stylesheet.ts'
import css from './switch.css' with { type: 'text' }

export const SWITCH_STYLES = stylesheet(css)

export function Switch(
  props: Record<string, unknown> & { size?: 'default' | 'sm' | undefined },
): Html {
  let { size = 'default', ...attributes } = props
  return (
    <span data-slot="switch" data-size={size}>
      <input type="checkbox" role="switch" {...attributes} />
      <span data-slot="switch-thumb"></span>
    </span>
  )
}
