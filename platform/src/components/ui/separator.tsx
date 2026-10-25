// shadcn/ui's Separator, in its base-nova style: a 1px line across its container, or down it when
// vertical (in a flex row).
import type { Html } from '#jsx/jsx-runtime'

import { stylesheet } from '../stylesheet.ts'
import css from './separator.css' with { type: 'text' }

export const SEPARATOR_STYLES = stylesheet(css)

export function Separator(
  props: Record<string, unknown> & { orientation?: 'horizontal' | 'vertical' | undefined },
): Html {
  let { orientation = 'horizontal', ...attributes } = props
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      data-slot="separator"
      data-orientation={orientation}
      {...attributes}
    ></div>
  )
}
