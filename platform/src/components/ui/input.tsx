// shadcn/ui's Input, in its base-nova style: an <input> whose attributes go on it as they are.
// Give it an id for its label, and aria-invalid="true" when its value was refused.
import type { Html } from '#jsx/jsx-runtime'

import { stylesheet } from '../stylesheet.ts'
import css from './input.css' with { type: 'text' }

export const INPUT_STYLES = stylesheet(css)

export function Input(props: Record<string, unknown>): Html {
  return <input data-slot="input" {...props} />
}
