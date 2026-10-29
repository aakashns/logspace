// Pieces of a post shared by the feed and the post page.
import type { Array as Arr } from 'effect'

import { raw, type Html } from '#jsx/jsx-runtime'

import { formatPostDate } from '../data/posts/format.ts'
import {
  FULL_WIDTH_IMAGE_SIZES,
  type LinkPreview,
  type Photo,
  type Post,
  type Video,
} from '../data/posts/presentation.ts'
import { urls } from '../lib/urls.ts'
import { ShareButton } from './controls.tsx'
import { CaretLeftIcon, CaretRightIcon, CloseIcon } from './icons.tsx'
import css from './post.css' with { type: 'text' }
import { stylesheet } from './stylesheet.ts'
import { Button } from './ui/button.tsx'

// For the pages that show posts.
export const POST_STYLES = stylesheet(css)

// A small link preview card's thumbnail (see .small-card in post.css).
const LINK_THUMBNAIL_SIZES = '6.5rem'

// The line at the top of a post: date and time linking to the post's page, city, and a share
// button.
export function PostMeta(props: { post: Post; siteUrl: string }): Html {
  let { post } = props
  let href = urls.post(post.id)
  return (
    <header class="post-meta">
      <p>
        <a href={href} class="permalink">
          <time datetime={post.date}>{formatPostDate(post.date)}</time>
        </a>
        {post.city ? ` · ${post.city}` : null}
      </p>
      <ShareButton url={props.siteUrl + href} />
    </header>
  )
}

// The caption as HTML (see ../data/posts/caption.ts). Datastar ignores it, as it does all HTML made from
// what someone wrote.
export function Caption(props: { html: string }): Html {
  return (
    <div class="caption" data-ignore>
      {raw(props.html)}
    </div>
  )
}

// What goes under the caption: photos, a video, or a link preview.
export function PostMedia(props: {
  post: Post
  preview?: LinkPreview | undefined
  priority?: boolean | undefined
}): Html | null {
  let { post, preview, priority } = props
  switch (post.type) {
    case 'photos':
      return <PhotoCarousel id={`photos-${post.id}`} photos={post.photos} priority={priority} />
    case 'video':
      return <VideoPlayer video={post.video} />
    case 'text':
      return preview ? <LinkCard preview={preview} /> : null
  }
}

// Which photo the track is scrolled to, for the dots and arrows (see .carousel in post.css).
const SHOW_INDEX =
  "el.parentElement.style.setProperty('--index', Math.round(el.scrollLeft / el.clientWidth))"
// Opening or closing the lightbox resizes the track, and Chrome then snaps to the photo nearest
// its old offset, so the photo shown is noted before and scrolled back to after.
const NOTE_INDEX = "el.dataset.index = el.style.getPropertyValue('--index')"
const RESTORE_INDEX = 'el.firstElementChild.scrollLeft = el.dataset.index * el.clientWidth'
// Once the lightbox has opened, the browser picks copies of the photos for the whole screen
// rather than for the content column.
const FULL_SCREEN_SIZES = "el.querySelectorAll('img').forEach((img) => (img.sizes = '100vw'))"
// Scrolls the track a photo back or forward (data-step), and it snaps to that photo.
const STEP =
  'el.parentElement.firstElementChild.scrollBy({ left: el.dataset.step * el.parentElement.clientWidth })'
// In the lightbox, the arrow key in the button's aria-keyshortcuts presses it.
const STEP_BY_KEY =
  "evt.key === el.getAttribute('aria-keyshortcuts') && el.parentElement.matches(':modal') && (evt.preventDefault(), el.click())"

// A post's photos in a row to swipe through, as on Instagram: one photo keeps its own shape, and
// more (or one whose size couldn't be read) take the default box (see .carousel-frame in
// post.css), with arrows and a dot for each when there's more than one. The row is
// a <dialog> shown in place, so clicking a photo opens the same element as a modal lightbox, at
// the same photo, where photos are shown whole; its close button or Escape closes it. The frame
// keeps the row's space in the page while it's open.
function PhotoCarousel(props: {
  id: string
  photos: Arr.NonEmptyReadonlyArray<Photo>
  priority?: boolean | undefined
}): Html {
  let { id, photos, priority } = props
  let many = photos.length > 1
  let aspectRatio = many ? undefined : displayAspectRatio(photos[0])
  return (
    <div
      class="carousel-frame"
      data-box={!aspectRatio}
      data-many={many}
      style={`--count: ${photos.length}${aspectRatio ? `; --aspect-ratio: ${aspectRatio}` : ''}`}
    >
      <dialog
        id={id}
        aria-label="Photos"
        class="carousel"
        data-on:beforetoggle={many ? NOTE_INDEX : undefined}
        data-on:toggle={many ? RESTORE_INDEX : undefined}
        data-on:command={FULL_SCREEN_SIZES}
      >
        <div class="carousel-track" data-on:scroll={many ? SHOW_INDEX : undefined}>
          {/* Each photo's button lies over it rather than around it, because Reader views
              drop buttons and all they hold. */}
          {photos.map((photo, index) => (
            <div class="carousel-slide">
              <PostImage photo={photo} priority={priority && index === 0} />
              <button
                type="button"
                command="show-modal"
                commandfor={id}
                aria-label="Open photo"
                class="carousel-open"
              />
            </div>
          ))}
        </div>
        {many ? (
          <>
            <StepButton step={-1} />
            <StepButton step={1} />
            <div class="carousel-dots" aria-hidden="true">
              {photos.map(() => (
                <span />
              ))}
            </div>
          </>
        ) : null}
        <Button
          command="close"
          commandfor={id}
          autofocus
          variant="ghost"
          size="icon-lg"
          aria-label="Close"
          class="carousel-close"
        >
          <CloseIcon />
        </Button>
      </dialog>
    </div>
  )
}

function StepButton(props: { step: -1 | 1 }): Html {
  let back = props.step === -1
  return (
    <Button
      variant="secondary"
      size="icon-sm"
      aria-label={back ? 'Previous photo' : 'Next photo'}
      aria-keyshortcuts={back ? 'ArrowLeft' : 'ArrowRight'}
      class="carousel-step"
      data-step={props.step}
      data-on:click={STEP}
      data-on:keydown__window={STEP_BY_KEY}
    >
      {back ? <CaretLeftIcon /> : <CaretRightIcon />}
    </Button>
  )
}

function VideoPlayer(props: { video: Video }): Html {
  let { video } = props
  let aspectRatio = displayAspectRatio(video)
  return (
    <video
      src={video.src}
      poster={video.poster}
      width={video.width}
      height={video.height}
      controls
      playsinline
      preload="metadata"
      style={aspectRatio ? `aspect-ratio: ${aspectRatio}` : undefined}
      class="media-frame video"
    />
  )
}

function LinkCard(props: { preview: LinkPreview }): Html {
  let { preview } = props
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener"
      class={`media-frame link-preview${preview.smallImage ? ' small-card' : ''}`}
    >
      {preview.image ? (
        <PostImage
          photo={preview.image}
          sizes={preview.smallImage ? LINK_THUMBNAIL_SIZES : undefined}
          class="card-image"
        />
      ) : null}
      <div class="card-text">
        <span class="link-domain">{preview.domain}</span>
        {preview.title ? <h2>{preview.title}</h2> : null}
        {preview.description ? <p>{preview.description}</p> : null}
      </div>
    </a>
  )
}

// The first post's media loads right away; everything else waits until it's scrolled near. The
// browser picks the resized copy of the photo that fits `sizes` (full width by default).
function PostImage(props: {
  photo: Photo
  priority?: boolean | undefined
  sizes?: string | undefined
  class?: string | undefined
}): Html {
  let { photo, priority, sizes = FULL_WIDTH_IMAGE_SIZES } = props
  return (
    <img
      src={photo.src}
      srcset={photo.srcset}
      sizes={photo.srcset ? sizes : undefined}
      alt={photo.alt}
      width={photo.width}
      height={photo.height}
      loading={priority ? 'eager' : 'lazy'}
      fetchpriority={priority ? 'high' : undefined}
      decoding="async"
      class={props.class}
    />
  )
}

// Very tall media is cropped (photos) or letterboxed (videos) to 4:5 so one post can't fill the
// whole screen. Without a known size, the media keeps its natural shape.
function displayAspectRatio({
  width,
  height,
}: {
  width?: number | undefined
  height?: number | undefined
}) {
  return width && height ? String(Math.max(width / height, 4 / 5)) : undefined
}
