// Pieces of a post shared by the feed and the post page.
import type { Array as Arr } from 'effect'

import { raw, type Html } from '#jsx/jsx-runtime'

import { FULL_WIDTH_IMAGE_SIZES, HALF_WIDTH_IMAGE_SIZES } from '../domain/constants.ts'
import { formatPostDate } from '../domain/format.ts'
import type { ArticlePost, Photo, Post, Video } from '../domain/presentation.ts'
import type { LinkPreview } from '../queries/link-previews.ts'
import { routes } from '../routes.ts'
import { ShareButton } from './controls.tsx'

// The line at the top of a post: date and time linking to the post's page, city, and a share
// button.
export function PostMeta(props: { post: Post; siteUrl: string }): Html {
  let { post } = props
  let href = routes.post(post.id)
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

// The caption, rendered from Markdown with its URLs turned into links. Datastar ignores it, as it
// does all HTML made from what someone wrote.
export function Caption(props: { html: string }): Html {
  return (
    <div class="caption" data-ignore>
      {raw(props.html)}
    </div>
  )
}

// What goes under the caption: photos, a video, an article card, or a link preview. The feed
// shows up to four photos in a grid; the post page (`full`) shows them all, one after another.
export function PostMedia(props: {
  post: Post
  preview?: LinkPreview | undefined
  full?: boolean | undefined
  priority?: boolean | undefined
}): Html | null {
  let { post, preview, full, priority } = props
  switch (post.type) {
    case 'photos':
      return full ? (
        <PhotoList photos={post.photos} priority={priority} />
      ) : (
        <PhotoGrid photos={post.photos} priority={priority} />
      )
    case 'video':
      return <VideoPlayer video={post.video} />
    case 'article':
      return <ArticleCard article={post.article} priority={priority} />
    case 'text':
      return preview ? <LinkCard preview={preview} /> : null
  }
}

// A single photo keeps its own shape; two to four share a 16:9 frame, split the way X does it.
// Past four, the last tile says how many more there are.
function PhotoGrid(props: {
  photos: Arr.NonEmptyReadonlyArray<Photo>
  priority?: boolean | undefined
}): Html {
  let { photos, priority } = props
  if (photos.length === 1) {
    let [photo] = photos
    return (
      <PostImage
        photo={photo}
        priority={priority}
        aspectRatio={displayAspectRatio(photo)}
        class="media-frame single-photo"
      />
    )
  }
  let shown = photos.slice(0, 4)
  let more = photos.length - shown.length
  return (
    <div class="media-frame photo-grid" data-count={shown.length}>
      {shown.map((photo, index) => (
        <div class="grid-tile">
          <PostImage photo={photo} priority={priority} sizes={HALF_WIDTH_IMAGE_SIZES} />
          {more > 0 && index === shown.length - 1 ? <span class="more-photos">+{more}</span> : null}
        </div>
      ))}
    </div>
  )
}

function PhotoList(props: { photos: readonly Photo[]; priority?: boolean | undefined }): Html {
  return (
    <div class="photo-list">
      {props.photos.map((photo, index) => (
        <PostImage
          photo={photo}
          priority={props.priority && index === 0}
          class="media-frame single-photo"
        />
      ))}
    </div>
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

// In the feed the whole post links to the article, so the card itself isn't a link.
function ArticleCard(props: {
  article: ArticlePost['article']
  priority?: boolean | undefined
}): Html {
  let { article, priority } = props
  return (
    <div class="media-frame card">
      {article.cover ? (
        <PostImage photo={article.cover} priority={priority} class="card-image" />
      ) : null}
      <div class="card-text">
        <h2>{article.title}</h2>
        <p>{article.summary}</p>
      </div>
    </div>
  )
}

function LinkCard(props: { preview: LinkPreview }): Html {
  let { preview } = props
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener"
      class={`media-frame card link-card${preview.smallImage ? ' small-card' : ''}`}
    >
      {preview.image ? (
        <img src={preview.image} alt="" loading="lazy" decoding="async" class="card-image" />
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
  aspectRatio?: string | undefined
  class?: string | undefined
}): Html {
  let { photo, priority, sizes = FULL_WIDTH_IMAGE_SIZES, aspectRatio } = props
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
      style={aspectRatio ? `aspect-ratio: ${aspectRatio}` : undefined}
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
