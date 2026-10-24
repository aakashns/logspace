// The composer at /admin/posts/new, where posts are written: a caption, photos or a video added
// with the toolbar's buttons (uploaded as they're chosen), and below, the post as it'll look,
// which follows along as you write. Nothing is saved until it's posted: closing the page loses
// it.
//
// Datastar runs it with one-line attributes, like the buttons in ../controls.tsx. The parts the
// server re-renders have ids: the issues, media, and toolbar, which it replaces whole (so the
// file inputs start empty again), and the inside of the preview, which Datastar morphs into place
// (so its photos and video don't flicker as you type). `_uploading` is set by data-indicator on
// whatever is uploading; while it is, Post is off and the preview waits, since a preview posts the
// whole form, chosen files and all. Posting is the form's own submission, so without Datastar
// it's a plain form, whose files are uploaded when it's posted.
import type { Array as Arr } from 'effect'

import type { Child, Html } from '#jsx/jsx-runtime'

import type { ComposeValues } from '../../domain/compose.ts'
import { FULL_WIDTH_IMAGE_SIZES, HALF_WIDTH_IMAGE_SIZES } from '../../domain/constants.ts'
import type { PostIssue } from '../../domain/post.ts'
import type { LinkPreview, Photo, Post, Video } from '../../domain/presentation.ts'
import { routes } from '../../routes.ts'
import { Tooltip } from '../controls.tsx'
import { CloseIcon, ImageIcon, VideoIcon } from '../icons.tsx'
import { Caption, PostMedia, PostMeta } from '../post.tsx'

export const COMPOSER_IDS = {
  issues: 'composer-issues',
  media: 'composer-media',
  tools: 'composer-tools',
  preview: 'composer-preview',
}

export interface ComposerProps {
  readonly values: ComposeValues
  // The post as it'd be published now, its files served from /admin.
  readonly post: Post
  readonly linkPreview?: LinkPreview | undefined
  readonly siteUrl: string
  readonly issues?: readonly PostIssue[] | undefined
}

const UPDATE_MEDIA = `@post('${routes.admin.newPostMedia()}', {contentType: 'form'})`
const PREVIEW = `@post('${routes.admin.newPostPreview()}', {contentType: 'form'})`

export function ComposePage(props: ComposerProps): Html {
  let { values } = props
  return (
    <section class="admin-page">
      <h1 class="page-title">New Post</h1>
      <form
        method="post"
        action={routes.admin.newPost()}
        enctype="multipart/form-data"
        class="composer"
      >
        <input type="hidden" name="post_id" value={values.id} />
        <CaptionInput value={values.caption} />
        <ComposerIssues issues={props.issues} />
        <ComposerMedia {...props} />
        <div class="composer-bar">
          <ComposerTools />
          <button type="submit" class="button post-button" data-attr:disabled="$_uploading">
            Post
          </button>
        </div>
      </form>
      <section aria-labelledby="preview-heading" class="composer-preview">
        <h2 id="preview-heading">Preview</h2>
        <div id={COMPOSER_IDS.preview} class="feed">
          <ComposerPreview {...props} />
        </div>
      </section>
    </section>
  )
}

// Grows with what's typed (see .composer-text), like X's. While typing, the preview follows at
// most every 100 ms, and once more after the last keystroke; a newer preview cancels one still on
// its way. A modifier's dot can't be in a JSX attribute's name, so the handler is spread in.
function CaptionInput(props: { value: string }): Html {
  return (
    // A textarea drops a newline right after its start tag, so one goes there, and a value that
    // starts with a newline keeps it.
    <textarea
      name="caption"
      rows={3}
      aria-label="Caption"
      placeholder="What’s happening?"
      autofocus
      class="composer-text"
      {...{ 'data-on:input__throttle.100ms.trailing': `$_uploading || ${PREVIEW}` }}
    >
      {`\n${props.value}`}
    </textarea>
  )
}

// Why the post wasn't published, or why files weren't added.
export function ComposerIssues(props: { issues?: readonly PostIssue[] | undefined }): Html {
  let { issues = [] } = props
  return (
    <div id={COMPOSER_IDS.issues}>
      {issues.length > 0 ? (
        <div role="alert" class="alert">
          <ul>
            {issues.map((issue) => (
              <li>{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

// The post's media with buttons to remove each, and the hidden fields that hold it.
export function ComposerMedia(props: ComposerProps): Html {
  let { values, post } = props
  return (
    <div id={COMPOSER_IDS.media} class="composer-media">
      {post.type === 'photos' ? <PhotoTiles photos={post.photos} files={values.photos} /> : null}
      {post.type === 'video' && values.video ? (
        <VideoTile video={post.video} file={values.video} poster={values.poster} />
      ) : null}
      {values.photos.map((file) => (
        <input type="hidden" name="photo" value={file} />
      ))}
      {values.video ? <input type="hidden" name="video" value={values.video} /> : null}
      {values.poster ? <input type="hidden" name="poster" value={values.poster} /> : null}
    </div>
  )
}

// One photo shows at its own shape; more share a grid, as on X.
function PhotoTiles(props: {
  photos: Arr.NonEmptyReadonlyArray<Photo>
  files: readonly string[]
}): Html {
  let { photos, files } = props
  let sizes = photos.length === 1 ? FULL_WIDTH_IMAGE_SIZES : HALF_WIDTH_IMAGE_SIZES
  return (
    <div class="attachments" data-count={Math.min(photos.length, 4)}>
      {photos.map((photo, index) => {
        let file = files[index] ?? photo.alt
        return (
          <div class="attachment">
            <img
              src={photo.src}
              srcset={photo.srcset}
              sizes={photo.srcset ? sizes : undefined}
              alt={photo.alt}
              width={photo.width}
              height={photo.height}
            />
            <RemoveButton file={file} label={`Remove ${file}`} />
          </div>
        )
      })}
    </div>
  )
}

function VideoTile(props: { video: Video; file: string; poster?: string | undefined }): Html {
  let { video, file, poster } = props
  return (
    <div class="attachments" data-count="1">
      <div class="attachment">
        <video
          src={video.src}
          poster={video.poster}
          width={video.width}
          height={video.height}
          controls
          playsinline
          preload="metadata"
        />
        <RemoveButton file={file} label={`Remove ${file}`} />
      </div>
      {poster ? (
        <p class="muted attachment-note">
          Poster image: {poster} <RemoveButton file={poster} label="Remove it" text />
        </p>
      ) : (
        <p class="muted attachment-note">
          Without a poster image, phones show a black box until the video plays. Add one with the
          photo button.
        </p>
      )}
    </div>
  )
}

// Takes one file out of the post: a round × over its tile, or with `text`, the label as a link.
// It needs Datastar; without it, media can only be added.
function RemoveButton(props: { file: string; label: string; text?: boolean | undefined }): Html {
  let { file, label, text } = props
  return (
    <button
      type="button"
      name="remove"
      value={file}
      aria-label={text ? undefined : label}
      title={text ? undefined : label}
      class={text ? 'link-button' : 'remove-button'}
      data-on:click={UPDATE_MEDIA}
      data-indicator:_uploading
    >
      {text ? label : <CloseIcon />}
    </button>
  )
}

// The buttons that add media. They're the same for every post, so they can always be sent again
// to empty their file inputs: with a video, the photo button adds its poster, and the video
// button replaces it.
export function ComposerTools(): Html {
  return (
    <div id={COMPOSER_IDS.tools} class="composer-tools">
      <MediaPicker label="Add photos" name="image_uploads" accept="image/*" multiple>
        <ImageIcon />
      </MediaPicker>
      <MediaPicker label="Add a video" name="video_upload" accept="video/*">
        <VideoIcon />
      </MediaPicker>
      <span role="status" hidden class="uploading muted" data-attr:hidden="!$_uploading">
        <span class="spinner" aria-hidden="true" />
        Uploading…
      </span>
    </div>
  )
}

// An icon button that chooses files, which are uploaded right away.
function MediaPicker(props: {
  label: string
  name: string
  accept: string
  multiple?: boolean | undefined
  children: Child
}): Html {
  let { label, name, accept, multiple, children } = props
  return (
    <Tooltip label={label}>
      <label class="tool-button">
        {children}
        <input
          type="file"
          name={name}
          accept={accept}
          multiple={multiple}
          aria-label={label}
          class="visually-hidden"
          data-on:change={UPDATE_MEDIA}
          data-indicator:_uploading
        />
      </label>
    </Tooltip>
  )
}

// The post as the feed will show it.
export function ComposerPreview(props: ComposerProps): Html {
  let { post, linkPreview, siteUrl } = props
  if (post.type === 'text' && !post.captionHtml) {
    return <p class="muted composer-empty">Your post shows here as you write it.</p>
  }
  return (
    <article class="feed-post">
      <PostMeta post={post} siteUrl={siteUrl} />
      {post.captionHtml ? <Caption html={post.captionHtml} /> : null}
      <PostMedia post={post} preview={linkPreview} />
    </article>
  )
}
