// shadcn/ui's Textarea, in its base-nova style: a <textarea> that grows with what's written in it.
import type { Html } from '#jsx/jsx-runtime'

import { stylesheet } from '../stylesheet.ts'
import css from './textarea.css' with { type: 'text' }

export const TEXTAREA_STYLES = stylesheet(css)

export function Textarea(props: Record<string, unknown> & { value?: string | undefined }): Html {
  let { value, ...attributes } = props
  // A textarea drops a newline right after its start tag, so one goes there, and a value that
  // starts with a newline keeps it.
  return (
    <textarea data-slot="textarea" {...attributes}>
      {`\n${value ?? ''}`}
    </textarea>
  )
}
