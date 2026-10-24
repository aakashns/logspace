// Labelled inputs for the admin forms. `invalid` is the input's aria-invalid.
import type { Child, Html } from '#jsx/jsx-runtime'

// A label and hint around any input.
export function Field(props: {
  label: string
  for: string
  hint?: string | undefined
  children: Child
}): Html {
  return (
    <div class="field">
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
  value?: string | undefined
  invalid?: 'true' | undefined
  hint?: string | undefined
}

export function TextField(props: InputProps): Html {
  let { label, name, id, value, invalid, hint } = props
  return (
    <Field label={label} for={id} hint={hint}>
      <input id={id} name={name} value={value ?? ''} aria-invalid={invalid} class="input" />
    </Field>
  )
}

export function TextareaField(props: InputProps & { rows: number }): Html {
  let { label, name, id, value, invalid, hint, rows } = props
  return (
    <Field label={label} for={id} hint={hint}>
      {/* A textarea drops a newline right after its start tag, so one goes there, and a value
          that starts with a newline keeps it. */}
      <textarea id={id} name={name} rows={rows} aria-invalid={invalid} class="input">
        {`\n${value ?? ''}`}
      </textarea>
    </Field>
  )
}
