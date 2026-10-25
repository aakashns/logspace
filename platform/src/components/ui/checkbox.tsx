// shadcn/ui's Checkbox, in its base-nova style. It's a native checkbox, so it's sent with its form
// and works without JavaScript; the check mark is drawn over it. Its attributes go on the <input>.
import type { Html } from '#jsx/jsx-runtime'

import { CheckIcon } from '../icons.tsx'
import { stylesheet } from '../stylesheet.ts'
import css from './checkbox.css' with { type: 'text' }

export const CHECKBOX_STYLES = stylesheet(css)

export function Checkbox(props: Record<string, unknown>): Html {
  return (
    <span data-slot="checkbox">
      <input type="checkbox" {...props} />
      <CheckIcon />
    </span>
  )
}
