// The composer, where posts are written and edited: a caption, photos or a video added with the
// toolbar's buttons, or photos pasted or dropped anywhere on the page (uploaded as they're added), and below, the post as it'll look, which follows
// along as you write. Nothing is saved until it's posted: closing the page loses it.
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

import { Tooltip } from '../../../components/controls.tsx'
import { CloseIcon, ImageIcon, VideoIcon } from '../../../components/icons.tsx'
import { Caption, POST_STYLES, PostMedia, PostMeta } from '../../../components/post.tsx'
import { stylesheet } from '../../../components/stylesheet.ts'
import { Button } from '../../../components/ui/button.tsx'
import {
  DialogClose,
  DialogContent,
  DialogFooter,
  DIALOG_STYLES,
} from '../../../components/ui/dialog.tsx'
import type { PostIssue } from '../../../data/posts/post.ts'
import {
  FULL_WIDTH_IMAGE_SIZES,
  HALF_WIDTH_IMAGE_SIZES,
  type LinkPreview,
  type Photo,
  type Post,
  type Video,
} from '../../../data/posts/presentation.ts'
import { urls } from '../../../lib/urls.ts'
import type { ComposeValues } from './form.ts'
import css from './page.css' with { type: 'text' }

// The preview shows the post as its page does.
export const COMPOSE_PAGE_STYLES = POST_STYLES + DIALOG_STYLES + stylesheet(css)

export const COMPOSER_IDS = {
  issues: 'composer-issues',
  media: 'composer-media',
  tools: 'composer-tools',
  preview: 'composer-preview',
}

export interface ComposerProps {
  readonly values: ComposeValues
  // The post as it'd be posted now, its files served from /admin.
  readonly post: Post
  readonly linkPreview?: LinkPreview | undefined
  readonly siteUrl: string
  readonly issues?: readonly PostIssue[] | undefined
  // Whether the post is published, so this is an edit.
  readonly published: boolean
}

const UPDATE_MEDIA = `@post('${urls.admin.postMedia()}', {contentType: 'form'})`
const PREVIEW = `@post('${urls.admin.postPreview()}', {contentType: 'form'})`
// Files pasted or dropped are put in the photo button's input and uploaded as if chosen with it,
// unless something is uploading. Text pasted or dropped has no files, so it's left alone, but a
// file dropped is kept from opening in the tab.
const ADD_FILES = (from: string) =>
  `!$_uploading && (el.files = ${from}.files).length && ${UPDATE_MEDIA}`
const DRAGGING_FILES = `evt.dataTransfer.types.includes('Files')`
const ACCEPT_FILES = `${DRAGGING_FILES} && evt.preventDefault()`
const DROP_HANDLERS = {
  'data-on:paste__window': ADD_FILES('evt.clipboardData'),
  'data-on:dragover__window': ACCEPT_FILES,
  'data-on:drop__window': `${ACCEPT_FILES}; ${ADD_FILES('evt.dataTransfer')}`,
}

export function ComposePage(props: ComposerProps): Html {
  let { values, published } = props
  return (
    <section class="admin-page">
      <div class="admin-heading">
        <h1 class="page-title">{published ? 'Edit Post' : 'New Post'}</h1>
        <CloseButton published={published} />
      </div>
      <form
        id={COMPOSER_FORM}
        method="post"
        action={urls.admin.savePost()}
        enctype="multipart/form-data"
        class="composer"
      >
        <input type="hidden" name="post_id" value={values.id} />
        <CaptionInput value={values.caption} />
        <ComposerIssues issues={props.issues} />
        <ComposerMedia {...props} />
        <div class="composer-bar">
          <ComposerTools />
          <div class="actions">
            {/* Opens the dialog below with command/commandfor, which needs no JavaScript. */}
            {published ? (
              <button
                type="button"
                command="show-modal"
                commandfor={DELETE_DIALOG}
                class="destructive-button"
              >
                Delete
              </button>
            ) : null}
            <button type="submit" class="button post-button" data-attr:disabled="$_uploading">
              {published ? 'Save' : 'Post'}
            </button>
          </div>
        </div>
      </form>
      {published ? <DeleteDialog id={values.id} /> : null}
      <DropOverlay />
      <section aria-labelledby="preview-heading" class="composer-preview">
        <h2 id="preview-heading">Preview</h2>
        <div id={COMPOSER_IDS.preview} class="feed">
          <ComposerPreview {...props} />
        </div>
      </section>
    </section>
  )
}

const COMPOSER_FORM = 'composer'

// Says files dragged over the page can be dropped anywhere on it, while they're over it. It covers
// the page, and its insides don't take the pointer, so it's only left when the drag leaves the
// window or is cancelled. Not while something is uploading, since drops are ignored then.
function DropOverlay(): Html {
  return (
    <div
      hidden
      aria-hidden="true"
      class="drop-overlay"
      data-attr:hidden="!$_dragging"
      data-on:dragenter__window={`!$_uploading && ${DRAGGING_FILES} && ($_dragging = true)`}
      data-on:dragleave="$_dragging = false"
      data-on:drop__window="$_dragging = false"
    >
      <ImageIcon />
      <p>Drop photos to add them</p>
    </div>
  )
}

// Closes the composer, like a dialog's ×, back to the list of posts: a new post is discarded,
// and an edit's changes. It posts the composer's form to discard what was uploaded for it, so
// it's off while files upload.
function CloseButton(props: { published: boolean }): Html {
  let label = props.published ? 'Revert changes' : 'Discard post'
  return (
    <Tooltip label={label}>
      <button
        type="submit"
        form={COMPOSER_FORM}
        formaction={urls.admin.discardPost()}
        aria-label={label}
        class="nav-button"
        data-attr:disabled="$_uploading"
      >
        <CloseIcon />
      </button>
    </Tooltip>
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
// button replaces it. Photos pasted or dropped go through the photo button.
export function ComposerTools(): Html {
  return (
    <div id={COMPOSER_IDS.tools} class="composer-tools">
      <MediaPicker label="Add photos" name="image_uploads" accept="image/*" multiple takesDrops>
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
  // Whether files pasted or dropped on the page are added with it.
  takesDrops?: boolean | undefined
  children: Child
}): Html {
  let { label, name, accept, multiple, takesDrops, children } = props
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
          {...(takesDrops ? DROP_HANDLERS : {})}
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

const DELETE_DIALOG = 'delete-post'

// Deleting a post: a dialog to confirm, outside the composer's form, since forms can't nest.
function DeleteDialog(props: { id: string }): Html {
  return (
    <DialogContent
      id={DELETE_DIALOG}
      title="Delete this post?"
      description="It’s removed from the site right away, along with its media files, and this can’t be undone."
    >
      <form method="post" action={urls.admin.deletePost(props.id)}>
        <DialogFooter>
          <DialogClose dialog={DELETE_DIALOG} variant="outline" autofocus>
            Cancel
          </DialogClose>
          <Button type="submit" variant="destructive">
            Delete
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
