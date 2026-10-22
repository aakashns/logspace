import type { Handle, RemixNode } from 'remix/component'
import { css } from 'remix/component'

import { mutedStyle } from '../ui/styles.ts'
import { FieldRow, TextareaField, TextField } from '../ui/fields.tsx'
import { MediaFileField, SizeFields, UploadField } from './fields.tsx'
import {
  POST_TYPES,
  type InvalidCheck,
  type PhotoValues,
  type PostFormValues,
} from './form-values.ts'

// The post form's fields for each type of post but text, which only has the caption.

interface TypeFieldsProps {
  values: PostFormValues
  invalid: InvalidCheck
  // On the new post page every type's fields are there, and only the chosen type's show.
  isNew: boolean
}

// Blank photo rows shown after a post's photos, for adding more.
const EMPTY_PHOTO_ROWS = 2

export function PhotosFields(handle: Handle<TypeFieldsProps>) {
  return () => {
    let { values, invalid, isNew } = handle.props
    let photos: PhotoValues[] = [
      ...(values.photos ?? []),
      ...Array.from({ length: EMPTY_PHOTO_ROWS }, () => ({})),
    ]
    return (
      <TypeFieldset type="photos" legend="Photos" isNew={isNew}>
        <p mix={mutedStyle}>
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
      </TypeFieldset>
    )
  }
}

export function VideoFields(handle: Handle<TypeFieldsProps>) {
  return () => {
    let { values, invalid, isNew } = handle.props
    let video = values.video ?? {}
    return (
      <TypeFieldset type="video" legend="Video" isNew={isNew}>
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
          <SizeFields prefix="video_" id="video" media={video} invalid={invalid} field="video" />
        </FieldRow>
      </TypeFieldset>
    )
  }
}

export function ArticleFields(handle: Handle<TypeFieldsProps>) {
  return () => {
    let { values, invalid, isNew } = handle.props
    let article = values.article ?? {}
    let cover = article.cover ?? {}
    return (
      <TypeFieldset type="article" legend="Article" isNew={isNew}>
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
      </TypeFieldset>
    )
  }
}

// A box around one type's fields. On the new post page it's tagged with its type, so CSS shows
// it only while that type is chosen.
function TypeFieldset(
  handle: Handle<{ type: string; legend: string; isNew: boolean; children: RemixNode }>,
) {
  return () => {
    let { type, legend, isNew, children } = handle.props
    return (
      <fieldset data-post-type={isNew ? type : undefined} mix={typeFieldsetStyle}>
        <legend>{legend}</legend>
        {children}
      </fieldset>
    )
  }
}

// The show/hide rules live here rather than on the form since each css() is its own cascade
// layer, and a later layer wins whatever the selectors' specificity.
const typeFieldsetStyle = css({
  display: 'flex',
  '&[data-post-type]': { display: 'none' },
  ...Object.fromEntries(
    POST_TYPES.map((type) => [
      // Nested selectors have to start with &, so the form's condition goes in :is().
      `&[data-post-type="${type}"]:is(form:has(input[name="type"][value="${type}"]:checked) *)`,
      { display: 'flex' },
    ]),
  ),
  flexDirection: 'column',
  gap: '0.75rem',
  padding: '1rem',
  border: '1px solid var(--border)',
  borderRadius: '0.75rem',
  '& legend': { paddingInline: '0.375rem', fontWeight: 600 },
})
