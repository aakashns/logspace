// shadcn/ui's Label and Field, in their base-nova style: a label, and the parts that go around a
// control in a form. Nothing here links them: give the control an id for FieldLabel's `for`, and
// an aria-describedby naming its description's or error's id, so screen readers read them too.
import type { Child, Html } from '#jsx/jsx-runtime'

import { stylesheet } from '../stylesheet.ts'
import css from './field.css' with { type: 'text' }

export const FIELD_STYLES = stylesheet(css)

type Props = Record<string, unknown> & { children?: Child }

export function Label(props: Props): Html {
  let { children, ...attributes } = props
  return (
    <label data-slot="label" {...attributes}>
      {children}
    </label>
  )
}

// Fields one above the other.
export function FieldGroup(props: Props): Html {
  let { children, ...attributes } = props
  return (
    <div data-slot="field-group" {...attributes}>
      {children}
    </div>
  )
}

// Related fields, like a choice of checkboxes, with a FieldLegend as their name.
export function FieldSet(props: Props): Html {
  let { children, ...attributes } = props
  return (
    <fieldset data-slot="field-set" {...attributes}>
      {children}
    </fieldset>
  )
}

export function FieldLegend(props: Props & { variant?: 'legend' | 'label' | undefined }): Html {
  let { variant = 'legend', children, ...attributes } = props
  return (
    <legend data-slot="field-legend" data-variant={variant} {...attributes}>
      {children}
    </legend>
  )
}

// A label and its control, with a description or error: vertical stacks them, and horizontal puts
// the control (like a checkbox or switch) beside its label. `invalid` colors it all as an error.
export function Field(
  props: Props & {
    orientation?: 'vertical' | 'horizontal' | undefined
    invalid?: boolean | undefined
    disabled?: boolean | undefined
  },
): Html {
  let { orientation = 'vertical', invalid, disabled, children, ...attributes } = props
  return (
    <div
      role="group"
      data-slot="field"
      data-orientation={orientation}
      data-invalid={invalid ? 'true' : undefined}
      data-disabled={disabled ? 'true' : undefined}
      {...attributes}
    >
      {children}
    </div>
  )
}

// A label and description together, beside a horizontal field's control.
export function FieldContent(props: Props): Html {
  let { children, ...attributes } = props
  return (
    <div data-slot="field-content" {...attributes}>
      {children}
    </div>
  )
}

export function FieldLabel(props: Props): Html {
  let { children, ...attributes } = props
  return (
    <label data-slot="field-label" {...attributes}>
      {children}
    </label>
  )
}

export function FieldDescription(props: Props): Html {
  let { children, ...attributes } = props
  return (
    <p data-slot="field-description" {...attributes}>
      {children}
    </p>
  )
}

// Why the field's value was refused, read out as soon as it's shown.
export function FieldError(props: Props): Html {
  let { children, ...attributes } = props
  return (
    <div role="alert" data-slot="field-error" {...attributes}>
      {children}
    </div>
  )
}
