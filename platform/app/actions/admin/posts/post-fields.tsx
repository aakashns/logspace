import type { Handle } from 'remix/component'
import { css } from 'remix/component'

import { getPostFileUrl } from '../../../data/posts.ts'
import { MAX_UPLOAD_FILE_SIZE, MAX_UPLOAD_TOTAL_SIZE } from '../../../lib/constants.ts'
import { inputStyle, mutedStyle } from '../styles.ts'
import { Field, FieldRow, TextareaField, TextField } from './fields.tsx'
import { POST_TYPES, type InvalidCheck, type PostFormValues } from './form-values.ts'

// The post form's fields that every type of post has.

interface PostFieldsProps {
  values: PostFormValues
  invalid: InvalidCheck
}

// A new post's type, chosen with radio buttons; an existing post's type can't change, so it's
// just shown.
export function TypePicker(handle: Handle<{ isNew: boolean; type: string }>) {
  return () => {
    let { isNew, type } = handle.props
    if (!isNew) {
      return (
        <p>
          Type: {typeName(type)} <span mix={mutedStyle}>(can’t be changed)</span>
        </p>
      )
    }
    return (
      <fieldset mix={typesStyle}>
        <legend>Type</legend>
        {POST_TYPES.map((option) => (
          <label>
            <input type="radio" name="type" value={option} checked={type === option} />
            {` ${typeName(option)}`}
          </label>
        ))}
      </fieldset>
    )
  }
}

// When and where it was posted. The date is entered as a local time plus a UTC offset, which the
// form joins back into one ISO date (see readPostForm).
export function DateFields(handle: Handle<PostFieldsProps>) {
  return () => {
    let { values, invalid } = handle.props
    let [, local = '', offset] = values.date.match(/^(.*?)(Z|[+-]\d{2}:\d{2})?$/) ?? []
    // Seconds are shown only when a post has them, since datetime-local rejects a time with
    // seconds unless step allows it.
    let hasSeconds = !/T\d{2}:\d{2}(:00)?$/.test(local)
    return (
      <FieldRow>
        <Field label="Date" for="date" size="wide">
          <input
            id="date"
            name="date"
            type="datetime-local"
            step={hasSeconds ? '1' : undefined}
            required
            defaultValue={hasSeconds ? local : local.slice(0, 16)}
            aria-invalid={invalid('date')}
            mix={inputStyle}
          />
        </Field>
        <Field label="UTC offset" for="offset" size="small">
          <input
            id="offset"
            name="offset"
            required
            pattern="Z|[+\-]\d{2}:\d{2}"
            placeholder="+05:30"
            defaultValue={offset === 'Z' ? '+00:00' : (offset ?? '')}
            aria-invalid={invalid('date')}
            mix={inputStyle}
          />
        </Field>
        <TextField
          label="City (optional)"
          name="city"
          id="city"
          value={values.city}
          invalid={invalid('city')}
        />
      </FieldRow>
    )
  }
}

export function CaptionField(handle: Handle<PostFieldsProps>) {
  return () => {
    let { values, invalid } = handle.props
    return (
      <TextareaField
        label="Caption"
        name="caption"
        id="caption"
        rows={6}
        value={values.caption}
        invalid={invalid('caption')}
        hint="Markdown. Every new line is a line break, and a blank line starts a new paragraph. Required for text posts."
      />
    )
  }
}

// How media fields work, and the post's files so far, which they and an article's body can name.
// A published post's files link to where they're served.
export function MediaFiles(
  handle: Handle<{ id: string; isNew: boolean; files: { name: string; size: number }[] }>,
) {
  return () => {
    let { id, isNew, files } = handle.props
    return (
      <div mix={mediaStyle}>
        <p mix={mutedStyle}>
          Media fields take the name of one of this post’s files, like <code>photo.jpg</code>, or a
          photo or video to upload, which is saved under its own name (with dashes for spaces),
          replacing any file of that name. Uploads can be up to {formatSize(MAX_UPLOAD_FILE_SIZE)}{' '}
          each and {formatSize(MAX_UPLOAD_TOTAL_SIZE)} at a time. Photos are resized for each
          screen, so upload them at full size.
        </p>
        {files.length > 0 ? (
          <div>
            <p>This post’s files:</p>
            <ul mix={fileListStyle}>
              {files.map((file) => (
                <li>
                  {isNew ? (
                    <code>{file.name}</code>
                  ) : (
                    <a href={getPostFileUrl(id, file.name)}>
                      <code>{file.name}</code>
                    </a>
                  )}{' '}
                  <span mix={mutedStyle}>({formatSize(file.size)})</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    )
  }
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

function typeName(type: string) {
  return type.charAt(0).toUpperCase() + type.slice(1)
}

const typesStyle = css({
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.5rem 1.25rem',
  border: 'none',
  '& legend': { marginBottom: '0.375rem' },
  '& label': { display: 'flex', alignItems: 'center', gap: '0.375rem', cursor: 'pointer' },
})

const mediaStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  // File names can be longer than a phone screen is wide.
  overflowWrap: 'anywhere',
})

const fileListStyle = css({ marginTop: '0.25rem', paddingLeft: '1.25rem' })
