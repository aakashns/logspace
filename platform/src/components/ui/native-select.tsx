// shadcn/ui's NativeSelect, in its base-nova style: a plain <select>, with the browser's own list
// of options, and a caret in place of its arrow. Its attributes go on the <select>; its children
// are <option>s and <optgroup>s.
import type { Child, Html } from '#jsx/jsx-runtime'

import { CaretDownIcon } from '../icons.tsx'
import { stylesheet } from '../stylesheet.ts'
import css from './native-select.css' with { type: 'text' }

export const NATIVE_SELECT_STYLES = stylesheet(css)

export function NativeSelect(
  props: Record<string, unknown> & { size?: 'default' | 'sm' | undefined; children?: Child },
): Html {
  let { size = 'default', children, ...attributes } = props
  return (
    <div data-slot="native-select-wrapper" data-size={size}>
      <select data-slot="native-select" data-size={size} {...attributes}>
        {children}
      </select>
      <CaretDownIcon class="native-select-icon" />
    </div>
  )
}
