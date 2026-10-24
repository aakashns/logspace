// The composer at /admin/posts/new, where posts are written: a caption, media added with the
// toolbar's buttons (photos, a video, or an article from a Markdown file, uploaded as they're
// chosen), and below, the post as it'll look, which follows along as you write. The post is dated
// when it's posted. The parts the server re-renders as you write have ids: the issues, media, and
// toolbar, which it replaces whole (so their file inputs start empty, and data-init runs again),
// and the inside of the preview, which Datastar morphs into place (so its photos and video don't
// flicker as you type). Each of those requests saves the draft, which the note by the Post
// button says. Every tab with the composer open follows the draft: when another tab changes it,
// the server sends the whole composer again, which Datastar morphs into place. Their Datastar
// controls are in composer-controls.tsx.
import type { Array as Arr } from 'effect'

import type { Html } from '#jsx/jsx-runtime'

import { composeTextValues, type ArticleValues, type ComposeValues } from '../../domain/compose.ts'
import { FULL_WIDTH_IMAGE_SIZES, HALF_WIDTH_IMAGE_SIZES } from '../../domain/constants.ts'
import type { PostIssue } from '../../domain/post.ts'
import type { LinkPreview, Photo, Post, Video } from '../../domain/presentation.ts'
import { routes } from '../../routes.ts'
import { Tooltip } from '../controls.tsx'
import { CloseIcon, ImageIcon, MarkdownIcon, VideoIcon } from '../icons.tsx'
import { PostPage } from '../post-page.tsx'
import { Caption, PostMedia, PostMeta } from '../post.tsx'
import {
  ArticleTextInput,
  CaptionInput,
  CityInput,
  ClearFiles,
  ComposerForm,
  ComposerUpdates,
  MediaPicker,
  OffsetInput,
  PostButton,
  PreviewRefresh,
  Redirect,
  RemoveMediaButton,
  SavedDefaults,
  UploadingNote,
} from './composer-controls.tsx'

export const COMPOSER_IDS = {
  composer: 'composer-page',
  issues: 'composer-issues',
  media: 'composer-media',
  tools: 'composer-tools',
  draft: 'composer-draft',
  preview: 'composer-preview',
}

// Whether the composer's values were saved as the draft by the last request that sent them, or
// refused (as once its post is published); unset when there's nothing to save.
export type DraftState = 'saved' | 'refused' | undefined

export interface ComposerProps {
  readonly values: ComposeValues
  // The post as it'd be published now, its files served from /admin.
  readonly post: Post
  readonly linkPreview?: LinkPreview | undefined
  // An article's body, and the files it uses with whether each is uploaded yet.
  readonly articleHtml?: string | undefined
  readonly articleFiles?: readonly { name: string; uploaded: boolean }[] | undefined
  readonly siteUrl: string
  readonly issues?: readonly PostIssue[] | undefined
  readonly draft?: DraftState
}

// The page: the composer, and the stream of it as the draft changes in other tabs. `tab` names
// this tab, so it isn't sent its own changes.
export function ComposePage(props: ComposerProps & { tab: string }): Html {
  return (
    <>
      <Composer {...props} />
      <ComposerUpdates url={routes.admin.newPostUpdates(props.tab)} />
    </>
  )
}

export function Composer(props: ComposerProps & { tab: string }): Html {
  let { values } = props
  return (
    <section id={COMPOSER_IDS.composer} class="admin-page">
      <div class="admin-heading">
        <h1 class="page-title">New Post</h1>
        {/* Opens the dialog below with command/commandfor, which needs no JavaScript. */}
        <Tooltip label="Discard">
          <button
            type="button"
            command="show-modal"
            commandfor={DISCARD_DIALOG}
            aria-label="Discard"
            class="nav-button"
          >
            <CloseIcon />
          </button>
        </Tooltip>
      </div>
      {/* A field named id shadows form.id and makes Datastar rebuild the focused form. */}
      <ComposerForm id="composer">
        {/* data-saved: the post is a draft that's saved, not a new one (see ComposerUpdates). */}
        <input
          type="hidden"
          name="post_id"
          value={values.id}
          data-saved={props.draft === 'saved'}
          data-bind:_post-id
        />
        <input type="hidden" name="tab" value={props.tab} />
        <OffsetInput value={values.offset} />
        <CaptionInput value={values.caption} />
        <ComposerIssues issues={props.issues} />
        <ComposerMedia {...props} />
        <div class="composer-bar">
          <ComposerTools values={values} />
          <CityInput value={values.city} />
          <DraftNote state={props.draft} />
          <PostButton />
        </div>
      </ComposerForm>
      <section aria-labelledby="preview-heading" class="composer-preview">
        <h2 id="preview-heading">Preview</h2>
        <div id={COMPOSER_IDS.preview} class="feed">
          <ComposerPreview {...props} />
        </div>
      </section>
      <DiscardDialog id={values.id} />
    </section>
  )
}

const DISCARD_DIALOG = 'discard-post'

// Discarding the post: a dialog to confirm, outside the composer, since forms can't nest. It stays
// open when another tab's change is morphed in.
function DiscardDialog(props: { id: string }): Html {
  return (
    <dialog
      id={DISCARD_DIALOG}
      aria-labelledby={`${DISCARD_DIALOG}-title`}
      class="dialog"
      data-preserve-attr="open"
    >
      <form method="post" action={routes.admin.discardNewPost()}>
        <input type="hidden" name="post_id" value={props.id} />
        <h2 id={`${DISCARD_DIALOG}-title`} class="dialog-title">
          Discard this post?
        </h2>
        <p>What you’ve written is cleared, and the media you’ve added is deleted.</p>
        <div class="actions">
          <button type="submit" class="destructive-button">
            Discard
          </button>
          <button
            type="button"
            command="close"
            commandfor={DISCARD_DIALOG}
            autofocus
            class="secondary-button"
          >
            Keep writing
          </button>
        </div>
      </form>
    </dialog>
  )
}

// Why the post wasn't published, or why files weren't added. Once the post is published,
// `redirect` sends the browser to it; `clearFiles` empties the file inputs, when what was chosen
// was too big to send; and `refresh` updates the preview, once the media is re-rendered. That's
// here rather than in the media, so a composer sent from another tab's change doesn't post its
// preview, which would save the draft back.
export function ComposerIssues(props: {
  issues?: readonly PostIssue[] | undefined
  redirect?: string | undefined
  clearFiles?: boolean | undefined
  refresh?: boolean | undefined
}): Html {
  let { issues = [], redirect, clearFiles, refresh } = props
  return (
    <div id={COMPOSER_IDS.issues} class="composer-issues">
      {issues.length > 0 ? (
        <div role="alert" class="alert">
          <ul>
            {issues.map((issue) => (
              <li>{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {redirect ? <Redirect href={redirect} /> : null}
      {clearFiles ? <ClearFiles /> : null}
      {refresh ? <PreviewRefresh /> : null}
    </div>
  )
}

// Only an acknowledged save makes the submitted values the fields' defaults (see SavedDefaults).
export function DraftNote(props: { state: DraftState; values?: ComposeValues | undefined }): Html {
  let text = { saved: 'Saved', refused: 'Not saved' }
  let saved = props.state === 'saved' ? props.values : undefined
  return (
    <span id={COMPOSER_IDS.draft} role="status" class="muted draft-note">
      {saved ? <SavedDefaults id={saved.id} values={composeTextValues(saved)} /> : null}
      {props.state ? text[props.state] : ''}
    </span>
  )
}

// The post's media with buttons to remove each, and the hidden fields that hold it.
export function ComposerMedia(props: ComposerProps): Html {
  let { values, post, articleFiles = [] } = props
  let { article } = values
  return (
    <div id={COMPOSER_IDS.media} class="composer-media">
      {post.type === 'photos' ? <PhotoTiles photos={post.photos} files={values.photos} /> : null}
      {post.type === 'video' && values.video ? (
        <VideoTile video={post.video} file={values.video} poster={values.poster} />
      ) : null}
      {post.type === 'article' && article ? (
        <ArticleTile
          article={article}
          cover={post.article.cover}
          coverFile={values.cover}
          files={articleFiles}
        />
      ) : null}
      {values.photos.map((file) => (
        <input type="hidden" name="photo" value={file} />
      ))}
      {values.video ? <input type="hidden" name="video" value={values.video} /> : null}
      {values.poster ? <input type="hidden" name="poster" value={values.poster} /> : null}
      {values.cover ? <input type="hidden" name="cover" value={values.cover} /> : null}
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
            <RemoveMediaButton file={file} label={`Remove ${file}`} />
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
        <RemoveMediaButton file={file} label={`Remove ${file}`} />
      </div>
      {poster ? (
        <p class="muted attachment-note">
          Poster image: {poster} <RemoveMediaButton file={poster} label="Remove it" text />
        </p>
      ) : (
        <p class="muted attachment-note">
          Without a poster image, phones show a black box until the video plays. Add one with the
          image button.
        </p>
      )}
    </div>
  )
}

// The article's title and summary to edit, where its body came from, and the files the body uses,
// which are uploaded under their own names, as the body names them.
function ArticleTile(props: {
  article: ArticleValues
  cover?: Photo | undefined
  coverFile?: string | undefined
  files: readonly { name: string; uploaded: boolean }[]
}): Html {
  let { article, cover, coverFile, files } = props
  let words = article.body.split(/\s+/).filter(Boolean).length
  let missing = files.filter((file) => !file.uploaded).length
  return (
    <div class="attachments" data-count="1">
      <div class="attachment article-attachment">
        {cover ? (
          <img
            src={cover.src}
            srcset={cover.srcset}
            sizes={cover.srcset ? FULL_WIDTH_IMAGE_SIZES : undefined}
            alt={cover.alt}
            width={cover.width}
            height={cover.height}
            class="article-attachment-cover"
          />
        ) : null}
        <div class="article-attachment-fields">
          <ArticleTextInput
            name="article_title"
            value={article.title}
            label="Title"
            class="article-title-input"
          />
          <ArticleTextInput
            name="article_summary"
            value={article.summary}
            label="Summary (optional)"
            class="article-summary-input"
          />
          <p class="muted">
            {article.source ? `From ${article.source} · ` : ''}
            {words === 1 ? '1 word' : `${words} words`}
          </p>
          {files.length > 0 ? (
            <p class="muted">
              Uses{' '}
              {files.map((file, index) => (
                <>
                  {index > 0 ? ', ' : ''}
                  <span class={file.uploaded ? undefined : 'missing-file'}>{file.name}</span>
                </>
              ))}
              {missing === 0
                ? '. '
                : ` (${missing === 1 ? 'one isn’t' : `${missing} aren’t`} uploaded yet). `}
              <MediaPicker
                label="Upload files"
                name="article_files"
                accept="image/*,video/*"
                multiple
                text
              />
            </p>
          ) : null}
        </div>
        <RemoveMediaButton label="Remove the article" />
      </div>
      {coverFile ? (
        <p class="muted attachment-note">
          Cover image: {coverFile} <RemoveMediaButton file={coverFile} label="Remove it" text />
        </p>
      ) : (
        <p class="muted attachment-note">Add a cover image with the image button.</p>
      )}
      {/* The body and where it came from, sent back with every change. A textarea drops a newline
          right after its start tag, so one goes there. */}
      <textarea hidden name="article_body">
        {`\n${article.body}`}
      </textarea>
      <input type="hidden" name="article_source" value={article.source} />
    </div>
  )
}

// The buttons that add media. A post has one kind: with a video, the image button adds its
// poster, and with an article, its cover.
export function ComposerTools(props: { values: ComposeValues }): Html {
  let { photos, video, poster, article, cover } = props.values
  let image = video
    ? { name: 'poster_upload', label: poster ? 'Change the poster image' : 'Add a poster image' }
    : article
      ? { name: 'cover_upload', label: cover ? 'Change the cover image' : 'Add a cover image' }
      : { name: 'photo_uploads', label: 'Add photos' }
  return (
    <div id={COMPOSER_IDS.tools} class="composer-tools">
      <MediaPicker
        label={image.label}
        name={image.name}
        accept="image/*"
        multiple={image.name === 'photo_uploads'}
      >
        <ImageIcon />
      </MediaPicker>
      <MediaPicker
        label={video ? 'Replace the video' : 'Add a video'}
        name="video_upload"
        accept="video/*"
        disabled={photos.length > 0 || article !== undefined}
      >
        <VideoIcon />
      </MediaPicker>
      <MediaPicker
        label={article ? 'Replace the article' : 'Add an article from a Markdown file'}
        name="article_upload"
        accept=".md,.txt,text/markdown,text/plain"
        disabled={photos.length > 0 || video !== undefined}
      >
        <MarkdownIcon />
      </MediaPicker>
      <UploadingNote />
    </div>
  )
}

// The post as the feed will show it, and an article as its own page will.
export function ComposerPreview(props: ComposerProps): Html {
  let { post, linkPreview, articleHtml, siteUrl } = props
  if (post.type === 'text' && !post.captionHtml) {
    return <p class="muted composer-empty">Your post shows here as you write it.</p>
  }
  return (
    <>
      <article class="feed-post">
        <PostMeta post={post} siteUrl={siteUrl} />
        {post.captionHtml ? <Caption html={post.captionHtml} /> : null}
        <PostMedia post={post} preview={linkPreview} />
      </article>
      {post.type === 'article' ? (
        <div class="composer-article">
          <PostPage post={post} siteUrl={siteUrl} articleHtml={articleHtml} />
        </div>
      ) : null}
    </>
  )
}
