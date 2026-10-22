import type { Handle, RemixNode } from 'remix/component'
import { css } from 'remix/component'

import { inputStyle, mutedStyle } from '../styles.ts'
import type { InvalidCheck, PostFormValues } from './form-values.ts'

// Labelled inputs for the post form. `invalid` is the input's aria-invalid (see invalidCheck).

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

interface InputProps {
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

// One of the post's media files: its name, or a file to upload next to it, whose name replaces
// the typed one when the form is saved. The file input is named `upload`. Wide, so the file input
// has room to show the chosen file's name.
export function MediaFileField(handle: Handle<InputProps & { upload: string; accept: string }>) {
  return () => {
    let { label, name, id, value, invalid, hint, upload, accept } = handle.props
    return (
      <Field label={label} for={id} hint={hint} size="wide">
        <input
          id={id}
          name={name}
          defaultValue={value ?? ''}
          aria-invalid={invalid}
          mix={inputStyle}
        />
        <input
          type="file"
          name={upload}
          accept={accept}
          aria-label={`${label}: upload`}
          mix={fileInputStyle}
        />
      </Field>
    )
  }
}

// A file input for uploading any number of files at once.
export function UploadField(
  handle: Handle<{ label: string; name: string; id: string; accept: string; hint?: string }>,
) {
  return () => {
    let { label, name, id, accept, hint } = handle.props
    return (
      <Field label={label} for={id} hint={hint}>
        <input id={id} name={name} type="file" accept={accept} multiple mix={fileInputStyle} />
      </Field>
    )
  }
}

// Width and height inputs for a video, named `${prefix}width` and `${prefix}height`. `field` is the
// video's path in the post, "video", for matching issues.
export function SizeFields(
  handle: Handle<{
    prefix: string
    id: string
    media: NonNullable<PostFormValues['video']>
    field: string
    invalid: InvalidCheck
  }>,
) {
  return () => {
    let { prefix, id, media, field, invalid } = handle.props
    return (
      <>
        {(['width', 'height'] as const).map((dimension) => (
          <Field
            label={dimension === 'width' ? 'Width' : 'Height'}
            for={`${id}-${dimension}`}
            size="small"
          >
            <input
              id={`${id}-${dimension}`}
              name={`${prefix}${dimension}`}
              inputMode="numeric"
              defaultValue={media[dimension] === undefined ? '' : String(media[dimension])}
              aria-invalid={invalid(`${field}.${dimension}`)}
              mix={inputStyle}
            />
          </Field>
        ))}
      </>
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

const fileInputStyle = css({ maxWidth: '100%', fontSize: '0.875rem' })

const textareaStyle = css({ resize: 'vertical', lineHeight: 1.5 })

const monospaceStyle = css({ fontFamily: 'var(--font-mono)', fontSize: '0.875rem' })
