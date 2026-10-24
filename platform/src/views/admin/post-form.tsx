// The edit post page, with the fields of the post's type. New posts are written in the composer
// (compose.tsx).
import type { Child, Html } from '#jsx/jsx-runtime'

import { MAX_UPLOAD_FILE_SIZE, MAX_UPLOAD_TOTAL_SIZE } from '../../domain/constants.ts'
import { formatSize } from '../../domain/format.ts'
import {
  invalidCheck,
  type InvalidCheck,
  type PhotoValues,
  type PostFormValues,
} from '../../domain/post-form.ts'
import type { PostIssue } from '../../domain/post.ts'
import { routes } from '../../routes.ts'
import { Field, FieldRow, TextareaField, TextField, type InputProps } from './fields.tsx'

export interface PostFormProps {
  readonly values: PostFormValues
  // The post's files in media storage.
  readonly files: readonly { name: string; size: number }[]
  readonly issues?: readonly PostIssue[] | undefined
}

// Blank photo rows shown after a post's photos, for adding more.
const EMPTY_PHOTO_ROWS = 2

export function PostForm(props: PostFormProps): Html {
  let { values, files, issues = [] } = props
  let fields = { values, invalid: invalidCheck(issues) }

  return (
    <section class="admin-page">
      <h1 class="page-title">Edit Post</h1>
      {issues.length > 0 ? <IssueList issues={issues} /> : null}

      <form
        method="post"
        action={routes.admin.editPost(values.id)}
        enctype="multipart/form-data"
        class="form"
      >
        <p>
          Type: {typeName(values.type)} <span class="muted">(can’t be changed)</span>
        </p>
        <DateFields {...fields} />
        <TextareaField
          label="Caption"
          name="caption"
          id="caption"
          rows={6}
          value={values.caption}
          invalid={fields.invalid('caption')}
          hint="Markdown. Every new line is a line break, and a blank line starts a new paragraph. Required for text posts."
        />
        <MediaFiles id={values.id} files={files} />
        {values.type === 'photos' ? <PhotosFields {...fields} /> : null}
        {values.type === 'video' ? <VideoFields {...fields} /> : null}
        {values.type === 'article' ? <ArticleFields {...fields} /> : null}

        <div class="actions">
          <button type="submit" class="button">
            Save
          </button>
          <a href={routes.admin.index()} class="secondary-button">
            Cancel
          </a>
          {/* Opens the dialog below with command/commandfor, which needs no JavaScript. */}
          <button
            type="button"
            command="show-modal"
            commandfor={DELETE_DIALOG}
            class="destructive-button delete-button"
          >
            Delete
          </button>
        </div>
      </form>

      <DeleteDialog id={values.id} />
    </section>
  )
}

// Why a submitted post wasn't saved, one issue per line.
function IssueList(props: { issues: readonly PostIssue[] }): Html {
  return (
    <div role="alert" class="alert">
      <p>The post wasn’t saved:</p>
      <ul>
        {props.issues.map((issue) => (
          <li>
            {issue.field ? `${fieldLabel(issue.field)}: ` : ''}
            {issue.message}
          </li>
        ))}
      </ul>
    </div>
  )
}

// How an issue's field reads, e.g. "Photo 2 alt text" for "photos.1.alt".
function fieldLabel(field: string): string {
  let parts = field.split('.')
  let name = (key: string | undefined) =>
    key === undefined ? '' : (FIELD_NAMES[key] ?? key.replaceAll('_', ' '))
  if (parts[0] === 'photos') {
    return parts.length === 1 ? 'Photos' : `Photo ${Number(parts[1]) + 1} ${name(parts[2])}`
  }
  if (parts[0] === 'video') return `Video ${name(parts[1])}`
  if (parts[0] === 'article') {
    return parts[1] === 'cover' ? `Cover photo ${name(parts[2])}` : `Article ${name(parts[1])}`
  }
  return name(parts[0]).replace(/^./, (c) => c.toUpperCase())
}

const FIELD_NAMES: Record<string, string> = { alt: 'alt text', id: 'id' }

function typeName(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1)
}

interface FieldsProps {
  values: PostFormValues
  invalid: InvalidCheck
}

// When and where it was posted. The date is in UTC, which readPostForm marks with a Z.
function DateFields(props: FieldsProps): Html {
  let { values, invalid } = props
  let date = values.date.replace(/Z$/, '')
  // Seconds are shown only when a post has them, since datetime-local rejects a time with seconds
  // unless step allows it.
  let hasSeconds = !/T\d{2}:\d{2}(:00)?$/.test(date)
  return (
    <FieldRow>
      <Field label="Date (UTC)" for="date" size="wide">
        <input
          id="date"
          name="date"
          type="datetime-local"
          step={hasSeconds ? '1' : undefined}
          required
          value={hasSeconds ? date : date.slice(0, 16)}
          aria-invalid={invalid('date')}
          class="input"
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

// How media fields work, and the post's files so far, which they and an article's body can name,
// linking to where they're served.
function MediaFiles(props: { id: string; files: readonly { name: string; size: number }[] }): Html {
  let { id, files } = props
  return (
    <div class="media-files">
      <p class="muted">
        Media fields take the name of one of this post’s files, like <code>photo.jpg</code>, or a
        photo or video to upload, which is saved under its own name (with dashes for spaces),
        replacing any file of that name. Uploads can be up to {formatSize(MAX_UPLOAD_FILE_SIZE)}{' '}
        each and {formatSize(MAX_UPLOAD_TOTAL_SIZE)} at a time. Photos are resized for each screen,
        so upload them at full size.
      </p>
      {files.length > 0 ? (
        <div>
          <p>This post’s files:</p>
          <ul class="file-list">
            {files.map((file) => (
              <li>
                <a href={routes.postFile(id, file.name)}>
                  <code>{file.name}</code>
                </a>{' '}
                <span class="muted">({formatSize(file.size)})</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function PhotosFields(props: FieldsProps): Html {
  let { values, invalid } = props
  let photos: PhotoValues[] = [
    ...(values.photos ?? []),
    ...Array.from({ length: EMPTY_PHOTO_ROWS }, () => ({})),
  ]
  return (
    <TypeFields legend="Photos">
      <p class="muted">
        Shown in this order. Clear a file name to remove a photo; save to get more empty rows.
      </p>
      {photos.map((photo, i) => (
        <FieldRow>
          <MediaFileField
            label={`Photo ${i + 1} file`}
            name="photo_file"
            upload="photo_upload"
            accept="image/*"
            id={`photo-${i}-file`}
            value={photo.file}
            // "Expected at least one photo" is about the whole list; it marks the first row.
            invalid={invalid(`photos.${i}.file`) ?? (i === 0 ? invalid('photos') : undefined)}
          />
          <TextField
            label="Alt text"
            name="photo_alt"
            id={`photo-${i}-alt`}
            value={photo.alt}
            invalid={invalid(`photos.${i}.alt`)}
          />
        </FieldRow>
      ))}
      <UploadField
        label="Add photos"
        name="photo_uploads"
        id="photo-uploads"
        accept="image/*"
        hint="Choose any number at once. They’re added after the photos above, without alt text, which you can add after saving."
      />
    </TypeFields>
  )
}

function VideoFields(props: FieldsProps): Html {
  let { values, invalid } = props
  let video = values.video ?? {}
  return (
    <TypeFields legend="Video">
      <FieldRow>
        <MediaFileField
          label="Video file"
          name="video_file"
          upload="video_upload"
          accept="video/*"
          id="video-file"
          value={video.file}
          invalid={invalid('video.file')}
        />
        <MediaFileField
          label="Poster image (optional)"
          name="video_poster"
          upload="video_poster_upload"
          accept="image/*"
          id="video-poster"
          value={video.poster}
          invalid={invalid('video.poster')}
        />
      </FieldRow>
      <FieldRow>
        {(['width', 'height'] as const).map((dimension) => (
          <Field
            label={dimension === 'width' ? 'Width' : 'Height'}
            for={`video-${dimension}`}
            size="small"
          >
            <input
              id={`video-${dimension}`}
              name={`video_${dimension}`}
              inputmode="numeric"
              value={video[dimension] === undefined ? '' : String(video[dimension])}
              aria-invalid={invalid(`video.${dimension}`)}
              class="input"
            />
          </Field>
        ))}
      </FieldRow>
    </TypeFields>
  )
}

function ArticleFields(props: FieldsProps): Html {
  let { values, invalid } = props
  let article = values.article ?? {}
  let cover = article.cover ?? {}
  return (
    <TypeFields legend="Article">
      <TextField
        label="Title"
        name="article_title"
        id="article-title"
        value={article.title}
        invalid={invalid('article.title')}
      />
      <TextareaField
        label="Summary"
        name="article_summary"
        id="article-summary"
        rows={3}
        value={article.summary}
        invalid={invalid('article.summary')}
      />
      <TextareaField
        label="Body"
        name="article_body"
        id="article-body"
        rows={20}
        monospace
        value={article.body}
        invalid={invalid('article.body')}
        hint="Markdown. Images, videos, and links can name the post’s media files, like ![A desk](desk.jpg); an image or video on its own line shows full width."
      />
      <UploadField
        label="Upload files for the body"
        name="article_uploads"
        id="article-uploads"
        accept="image/*,video/*"
        hint="Saved as this post’s files, under their own names, for the body to name. A video’s poster is the image named like it, e.g. clip.jpg for clip.mp4."
      />
      <FieldRow>
        <MediaFileField
          label="Cover photo (optional)"
          name="cover_file"
          upload="cover_upload"
          accept="image/*"
          id="cover-file"
          value={cover.file}
          invalid={invalid('article.cover.file')}
        />
        <TextField
          label="Cover alt text"
          name="cover_alt"
          id="cover-alt"
          value={cover.alt}
          invalid={invalid('article.cover.alt')}
        />
      </FieldRow>
    </TypeFields>
  )
}

// A box around the type's fields.
function TypeFields(props: { legend: string; children: Child }): Html {
  return (
    <fieldset class="type-fields">
      <legend>{props.legend}</legend>
      {props.children}
    </fieldset>
  )
}

// One of the post's media files: its name, or a file to upload next to it, whose name replaces
// the typed one when the form is saved. Wide, so the file input has room to show the chosen
// file's name.
function MediaFileField(props: InputProps & { upload: string; accept: string }): Html {
  let { label, name, id, value, invalid, hint, upload, accept } = props
  return (
    <Field label={label} for={id} hint={hint} size="wide">
      <input id={id} name={name} value={value ?? ''} aria-invalid={invalid} class="input" />
      <input
        type="file"
        name={upload}
        accept={accept}
        aria-label={`${label}: upload`}
        class="file-input"
      />
    </Field>
  )
}

// A file input for uploading any number of files at once.
function UploadField(props: {
  label: string
  name: string
  id: string
  accept: string
  hint?: string | undefined
}): Html {
  let { label, name, id, accept, hint } = props
  return (
    <Field label={label} for={id} hint={hint}>
      <input id={id} name={name} type="file" accept={accept} multiple class="file-input" />
    </Field>
  )
}

const DELETE_DIALOG = 'delete-post'

// Deleting a post: a dialog to confirm, outside the post form, since forms can't nest.
function DeleteDialog(props: { id: string }): Html {
  return (
    <dialog id={DELETE_DIALOG} aria-labelledby={`${DELETE_DIALOG}-title`} class="dialog">
      <form method="post" action={routes.admin.deletePost(props.id)}>
        <h2 id={`${DELETE_DIALOG}-title`} class="dialog-title">
          Delete this post?
        </h2>
        <p>
          It’s removed from the site right away, along with its media files, and this can’t be
          undone.
        </p>
        <div class="actions">
          <button type="submit" class="destructive-button">
            Delete
          </button>
          <button
            type="button"
            command="close"
            commandfor={DELETE_DIALOG}
            autofocus
            class="secondary-button"
          >
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  )
}
