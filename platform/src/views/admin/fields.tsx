// Labelled inputs for the admin forms. `invalid` is the input's aria-invalid.
import type { Child, Html } from '#jsx/jsx-runtime'

// In a FieldRow, a wide field takes more of the space and a small one less.
type FieldSize = 'wide' | 'small'

// Fields side by side, wrapping onto more lines on narrow screens.
export function FieldRow(props: { children: Child }): Html {
  return <div class="field-row">{props.children}</div>
}

// A label and hint around any input.
export function Field(props: {
  label: string
  for: string
  hint?: string
  size?: FieldSize
  children: Child
}): Html {
  return (
    <div data-size={props.size} class="field">
      <label for={props.for}>{props.label}</label>
      {props.children}
      {props.hint ? <p class="muted">{props.hint}</p> : null}
    </div>
  )
}

export interface InputProps {
  label: string
  name: string
  id: string
  value?: string
  invalid?: 'true'
  hint?: string
}

export function TextField(props: InputProps & { size?: FieldSize }): Html {
  let { label, name, id, value, invalid, hint, size } = props
  return (
    <Field label={label} for={id} hint={hint} size={size}>
      <input id={id} name={name} value={value ?? ''} aria-invalid={invalid} class="input" />
    </Field>
  )
}

// `monospace` suits long Markdown, where the markup should stand out.
export function TextareaField(props: InputProps & { rows: number; monospace?: boolean }): Html {
  let { label, name, id, value, invalid, hint, rows, monospace } = props
  return (
    <Field label={label} for={id} hint={hint}>
      {/* A textarea drops a newline right after its start tag, so one goes there, and a value
          that starts with a newline keeps it. */}
      <textarea
        id={id}
        name={name}
        rows={rows}
        aria-invalid={invalid}
        class={monospace ? 'input monospace' : 'input'}
      >
        {`\n${value ?? ''}`}
      </textarea>
    </Field>
  )
}
