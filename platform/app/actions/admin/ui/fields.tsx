import type { Handle, RemixNode } from 'remix/component'
import { css } from 'remix/component'

import { inputStyle, mutedStyle } from './styles.ts'

// Labelled inputs for the admin forms. `invalid` is the input's aria-invalid.

// In a FieldRow, a wide field takes more of the space and a small one less.
type FieldSize = 'wide' | 'small'

// Fields side by side, wrapping onto more lines on narrow screens.
export function FieldRow(handle: Handle<{ children: RemixNode }>) {
  return () => <div mix={rowStyle}>{handle.props.children}</div>
}

// A label and hint around any input.
export function Field(
  handle: Handle<{
    label: string
    for: string
    hint?: string
    size?: FieldSize
    children: RemixNode
  }>,
) {
  return () => {
    let { label, hint, size, children } = handle.props
    return (
      <div data-size={size} mix={fieldStyle}>
        <label for={handle.props.for}>{label}</label>
        {children}
        {hint ? <p mix={mutedStyle}>{hint}</p> : null}
      </div>
    )
  }
}

export interface InputProps {
  label: string
  name: string
  id: string
  value?: string
  invalid?: 'true'
  hint?: string
}

export function TextField(handle: Handle<InputProps & { size?: FieldSize }>) {
  return () => {
    let { label, name, id, value, invalid, hint, size } = handle.props
    return (
      <Field label={label} for={id} hint={hint} size={size}>
        <input
          id={id}
          name={name}
          defaultValue={value ?? ''}
          aria-invalid={invalid}
          mix={inputStyle}
        />
      </Field>
    )
  }
}

// `monospace` suits long Markdown, where the markup should stand out.
export function TextareaField(handle: Handle<InputProps & { rows: number; monospace?: boolean }>) {
  return () => {
    let { label, name, id, value, invalid, hint, rows, monospace } = handle.props
    return (
      <Field label={label} for={id} hint={hint}>
        <textarea
          id={id}
          name={name}
          rows={rows}
          aria-invalid={invalid}
          defaultValue={value ?? ''}
          mix={[inputStyle, textareaStyle, monospace ? monospaceStyle : null]}
        />
      </Field>
    )
  }
}

const fieldStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '0.375rem',
})

const rowStyle = css({
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.75rem',
  '& > *': { flex: '1 1 8rem', minWidth: 0 },
  '& > [data-size="wide"]': { flex: '2 1 12rem' },
  '& > [data-size="small"]': { flex: '0 1 5rem' },
})

const textareaStyle = css({ resize: 'vertical', lineHeight: 1.5 })

const monospaceStyle = css({ fontFamily: 'var(--font-mono)', fontSize: '0.875rem' })
