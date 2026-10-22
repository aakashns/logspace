import type { Handle } from 'remix/component'
import { css } from 'remix/component'

import { Field, type InputProps } from '../ui/fields.tsx'
import { inputStyle } from '../ui/styles.ts'
import type { InvalidCheck, PostFormValues } from './form-values.ts'

// The post form's inputs for media files, and a video's size.

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

const fileInputStyle = css({ maxWidth: '100%', fontSize: '0.875rem' })
