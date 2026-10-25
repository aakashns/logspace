// Labelled inputs for the admin forms, made of the Field components in components/ui. `invalid`
// is the input's aria-invalid.
import type { Child, Html } from '#jsx/jsx-runtime'

import { Field, FIELD_STYLES, FieldDescription, FieldLabel } from '../../components/ui/field.tsx'
import { Input, INPUT_STYLES } from '../../components/ui/input.tsx'
import { Textarea, TEXTAREA_STYLES } from '../../components/ui/textarea.tsx'

// For the pages that use these.
export const FIELDS_STYLES = FIELD_STYLES + INPUT_STYLES + TEXTAREA_STYLES

// A label and hint around any input. The input names the hint with `hintId(id)`.
export function LabelledField(props: {
  label: string
  for: string
  hint?: string | undefined
  children: Child
}): Html {
  return (
    <Field>
      <FieldLabel for={props.for}>{props.label}</FieldLabel>
      {props.children}
      {props.hint ? <FieldDescription id={hintId(props.for)}>{props.hint}</FieldDescription> : null}
    </Field>
  )
}

export const hintId = (id: string) => `${id}-hint`

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
    <LabelledField label={label} for={id} hint={hint}>
      <Input
        id={id}
        name={name}
        value={value ?? ''}
        aria-invalid={invalid}
        aria-describedby={hint ? hintId(id) : undefined}
      />
    </LabelledField>
  )
}

export function TextareaField(props: InputProps & { rows: number }): Html {
  let { label, name, id, value, invalid, hint, rows } = props
  return (
    <LabelledField label={label} for={id} hint={hint}>
      <Textarea
        id={id}
        name={name}
        rows={rows}
        value={value}
        aria-invalid={invalid}
        aria-describedby={hint ? hintId(id) : undefined}
      />
    </LabelledField>
  )
}
