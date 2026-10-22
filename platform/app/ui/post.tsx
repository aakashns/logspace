import type { Handle, MixInput } from 'remix/component'
import { css, unsafeHTML } from 'remix/component'

import { getSiteConfig } from '../data/config.ts'
import type { LinkPreview } from '../data/link-previews.ts'
import type { ArticlePost, Photo, Post, Video } from '../data/posts/presentation.ts'
import { FULL_WIDTH_IMAGE_SIZES, HALF_WIDTH_IMAGE_SIZES } from '../lib/constants.ts'
import { renderCaption } from '../lib/caption.ts'
import { routes } from '../routes.ts'
import type { PreloadImage } from '../lib/page-meta.ts'
import { ShareButton } from './public/share-button.tsx'

// Pieces of a post shared by the feed and the post page.

// The line at the top of a post: date and time linking to the post's page, city, and a share
// button.
export function PostMeta(handle: Handle<{ post: Post }>) {
  return () => {
    let { post } = handle.props
    let href = routes.posts.show.href({ id: post.id })

    return (
      <header mix={metaStyle}>
        <p>
          <a href={href} mix={permalinkStyle}>
            <time dateTime={post.date}>{formatPostDate(post.date)}</time>
          </a>
          {post.city ? ` · ${post.city}` : null}
        </p>
        <ShareButton url={getSiteConfig().siteUrl + href} />
      </header>
    )
  }
}

// Caption text, rendered from Markdown with its URLs turned into links.
export function Caption(handle: Handle<{ text: string }>) {
  return () => <div mix={captionStyle} innerHTML={unsafeHTML(renderCaption(handle.props.text))} />
}

// What goes under the caption: photos, a video, an article card, or a link preview. The feed shows
// up to four photos in a grid; the post page shows them all, one after another.
export function PostMedia(
  handle: Handle<{ post: Post; preview?: LinkPreview; full?: boolean; priority?: boolean }>,
) {
  return () => {
    let { post, preview, full, priority } = handle.props
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
}

// The image that's likely the largest thing on screen when `post` is the first post shown (as
// PostMedia shows it, with `full` for the post's own page), for the document to preload: the first
// photo, an article's cover, or a video's poster.
export function getPriorityImage(post: Post, full = false): PreloadImage | undefined {
  let photo = (photo: Photo, sizes = FULL_WIDTH_IMAGE_SIZES): PreloadImage => ({
    href: photo.src,
    srcset: photo.srcset,
    sizes: photo.srcset ? sizes : undefined,
  })
  switch (post.type) {
    case 'photos': {
      let inGrid = !full && post.photos.length > 1
      return photo(post.photos[0], inGrid ? HALF_WIDTH_IMAGE_SIZES : FULL_WIDTH_IMAGE_SIZES)
    }
    case 'article':
      return post.article.cover && photo(post.article.cover)
    case 'video':
      return post.video.poster ? { href: post.video.poster } : undefined
    case 'text':
      return undefined
  }
}

// A single photo keeps its own shape; two to four share a 16:9 frame, split the way X does it. Past
// four, the last tile says how many more there are.
function PhotoGrid(handle: Handle<{ photos: Photo[]; priority?: boolean }>) {
  return () => {
    let { photos, priority } = handle.props

    if (photos.length === 1) {
      let [photo] = photos
      return (
        <PostImage
          photo={photo}
          priority={priority}
          aspectRatio={displayAspectRatio(photo)}
          mix={[mediaFrameStyle, singlePhotoStyle]}
        />
      )
    }

    let shown = photos.slice(0, 4)
    let more = photos.length - shown.length
    return (
      <div mix={[mediaFrameStyle, photoGridStyle]} data-count={shown.length}>
        {shown.map((photo, index) => (
          <div key={photo.src} mix={gridTileStyle}>
            <PostImage photo={photo} priority={priority} sizes={HALF_WIDTH_IMAGE_SIZES} />
            {more > 0 && index === shown.length - 1 ? <span mix={moreStyle}>+{more}</span> : null}
          </div>
        ))}
      </div>
    )
  }
}

function PhotoList(handle: Handle<{ photos: Photo[]; priority?: boolean }>) {
  return () => (
    <div mix={photoListStyle}>
      {handle.props.photos.map((photo, index) => (
        <PostImage
          key={photo.src}
          photo={photo}
          priority={handle.props.priority && index === 0}
          mix={[mediaFrameStyle, singlePhotoStyle]}
        />
      ))}
    </div>
  )
}

function VideoPlayer(handle: Handle<{ video: Video }>) {
  return () => {
    let { video } = handle.props

    return (
      <video
        src={video.src}
        poster={video.poster}
        width={video.width}
        height={video.height}
        controls
        playsInline
        preload="metadata"
        style={{ aspectRatio: displayAspectRatio(video) }}
        mix={[mediaFrameStyle, videoStyle]}
      />
    )
  }
}

// In the feed the whole post links to the article, so the card itself isn't a link.
function ArticleCard(handle: Handle<{ article: ArticlePost['article']; priority?: boolean }>) {
  return () => {
    let { article, priority } = handle.props

    return (
      <div mix={[mediaFrameStyle, cardStyle]}>
        {article.cover ? (
          <PostImage photo={article.cover} priority={priority} mix={cardImageStyle} />
        ) : null}
        <div mix={cardTextStyle}>
          <h2>{article.title}</h2>
          <p>{article.summary}</p>
        </div>
      </div>
    )
  }
}

function LinkCard(handle: Handle<{ preview: LinkPreview }>) {
  return () => {
    let { preview } = handle.props

    return (
      <a
        href={preview.url}
        target="_blank"
        rel="noopener"
        mix={[
          mediaFrameStyle,
          cardStyle,
          linkCardStyle,
          preview.smallImage ? smallCardStyle : null,
        ]}
      >
        {preview.image ? (
          <img src={preview.image} alt="" loading="lazy" decoding="async" mix={cardImageStyle} />
        ) : null}
        <div mix={cardTextStyle}>
          <span mix={domainStyle}>{preview.domain}</span>
          {preview.title ? <h2>{preview.title}</h2> : null}
          {preview.description ? <p>{preview.description}</p> : null}
        </div>
      </a>
    )
  }
}

// The first post's media loads right away; everything else waits until it's scrolled near. The
// browser picks the resized copy of the photo that fits `sizes` (full width by default).
function PostImage(
  handle: Handle<{
    photo: Photo
    priority?: boolean
    sizes?: string
    aspectRatio?: string
    mix?: MixInput<HTMLImageElement>
  }>,
) {
  return () => {
    let { photo, priority, sizes = FULL_WIDTH_IMAGE_SIZES, aspectRatio, mix } = handle.props
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
        style={aspectRatio ? { aspectRatio } : undefined}
        mix={mix}
      />
    )
  }
}

// "16 Oct 2026, 6:42 PM" in the time zone of the timestamp's own UTC offset, i.e. the local time
// where it was posted, whatever time zone the server runs in.
export function formatPostDate(iso: string) {
  let offset = iso.match(/[+-]\d{2}:\d{2}$/)?.[0] ?? 'UTC'
  // Assembled from parts because en-GB, which has this day-month-year order, spells September
  // "Sept" and uses a 24-hour clock.
  let parts = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: offset,
  }).formatToParts(new Date(iso))
  let part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value
  return `${part('day')} ${part('month')} ${part('year')}, ${part('hour')}:${part('minute')} ${part('dayPeriod')}`
}

// Very tall media is cropped (photos) or letterboxed (videos) to 4:5 so one post can't fill the
// whole screen. Without a known size, the media keeps its natural shape.
function displayAspectRatio({ width, height }: { width?: number; height?: number }) {
  return width && height ? String(Math.max(width / height, 4 / 5)) : undefined
}

const metaStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.5rem',
  color: 'var(--muted-foreground)',
})

const permalinkStyle = css({
  '&:hover': { textDecoration: 'underline' },
  '&:focus-visible': { outline: '2px solid var(--ring)', outlineOffset: '2px' },
})

// The caption sits closer to the date line than the gap between the other parts of a post.
// Paragraphs are a blank line apart.
const captionStyle = css({
  'header + &': { marginTop: '-0.5rem' },
  lineHeight: 1.6,
  overflowWrap: 'anywhere',
  '& > * + *': { marginTop: '1lh' },
  '& a': { color: 'var(--link)' },
  '& a:hover': { textDecoration: 'underline' },
  '& strong': { fontWeight: 650 },
  '& ul': { listStyle: 'disc', paddingLeft: '1.5rem' },
  '& ol': { listStyle: 'decimal', paddingLeft: '1.5rem' },
  '& blockquote': { paddingLeft: '1rem', borderLeft: '3px solid var(--border)' },
  // Tables scroll sideways rather than breaking words when they're wider than the caption.
  '& table': { display: 'block', maxWidth: '100%', overflowX: 'auto' },
  '& th, & td': {
    padding: '0.375rem 1rem 0.375rem 0',
    borderBottom: '1px solid var(--border)',
    textAlign: 'left',
    verticalAlign: 'top',
    overflowWrap: 'normal',
  },
  '& th': { fontWeight: 650 },
  '& code': {
    padding: '0.125rem 0.375rem',
    borderRadius: '0.375rem',
    backgroundColor: 'var(--muted)',
    fontSize: '0.875em',
  },
})

const mediaFrameStyle = css({
  display: 'block',
  width: '100%',
  overflow: 'hidden',
  border: '1px solid var(--border)',
  borderRadius: '1rem',
})

const singlePhotoStyle = css({
  height: 'auto',
  objectFit: 'cover',
  backgroundColor: 'var(--muted)',
})

const photoGridStyle = css({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gridTemplateRows: 'minmax(0, 1fr)',
  gap: '2px',
  aspectRatio: '16 / 9',
  '&[data-count="3"], &[data-count="4"]': {
    gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
  },
  '&[data-count="3"] > :first-child': { gridRow: 'span 2' },
})

const gridTileStyle = css({
  position: 'relative',
  minHeight: 0,
  '& > img': {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    backgroundColor: 'var(--muted)',
  },
})

const moreStyle = css({
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'oklch(0 0 0 / 45%)',
  color: 'white',
  fontSize: '1.75rem',
  fontWeight: 600,
})

const photoListStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
})

const videoStyle = css({
  height: 'auto',
  objectFit: 'contain',
  backgroundColor: 'black',
})

const cardStyle = css({
  display: 'flex',
  flexDirection: 'column',
})

const cardImageStyle = css({
  width: '100%',
  height: 'auto',
  aspectRatio: '1.91 / 1',
  objectFit: 'cover',
  borderBottom: '1px solid var(--border)',
  backgroundColor: 'var(--muted)',
})

const cardTextStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  minWidth: 0,
  padding: '0.75rem 1rem',
  '& h2': { fontSize: '1.0625rem', lineHeight: 1.35 },
  '& p': {
    fontSize: '0.9375rem',
    lineHeight: 1.5,
    color: 'var(--muted-foreground)',
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
})

const linkCardStyle = css({
  transition: 'background-color 150ms',
  '&:hover': { backgroundColor: 'color-mix(in oklch, var(--foreground) 4%, transparent)' },
  '&:focus-visible': { outline: '2px solid var(--ring)', outlineOffset: '2px' },
  '& h2': {
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
  '& p': { WebkitLineClamp: 2 },
})

// A square thumbnail beside the text, for sites that ask for a small card.
const smallCardStyle = css({
  flexDirection: 'row',
  alignItems: 'center',
  '& > img': {
    width: '6.5rem',
    flexShrink: 0,
    aspectRatio: '1',
    borderBottom: 0,
    borderRight: '1px solid var(--border)',
  },
})

const domainStyle = css({
  fontSize: '0.875rem',
  color: 'var(--muted-foreground)',
})
