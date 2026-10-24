// Posts as pages show them, with their media's URLs and their captions rendered. Pure: the read
// model (queries.ts) makes these from stored posts once per change, so pages only render.
import { Array as Arr } from 'effect'

import { getImageSources, getSrcset, type ImageInfo } from '../lib/image-widths.ts'
import { routes } from '../routes.ts'
import { captionText, renderCaption } from './caption.ts'
import { clamp } from './format.ts'
import type { PhotoRecord, PostRecord } from './post.ts'

// The `sizes` of a photo shown across the content column (36rem wide inside its padding, see
// --content-width in theme.css), and of one in the feed's two-column photo grid, for choosing
// between a photo's resized copies (see ../lib/image-widths.ts).
export const FULL_WIDTH_IMAGE_SIZES = '(min-width: 38rem) 36rem, calc(100vw - 2rem)'
export const HALF_WIDTH_IMAGE_SIZES = '(min-width: 38rem) 18rem, calc(50vw - 1rem)'

export type Post = TextPost | PhotosPost | VideoPost

interface BasePost {
  readonly id: string
  // In UTC, like "2026-10-16T13:12:00Z".
  readonly date: string
  readonly city?: string | undefined
  readonly caption?: string | undefined
  // The caption as HTML (see renderCaption).
  readonly captionHtml?: string | undefined
}

export interface TextPost extends BasePost {
  readonly type: 'text'
  readonly caption: string
}

export interface PhotosPost extends BasePost {
  readonly type: 'photos'
  readonly photos: Arr.NonEmptyReadonlyArray<Photo>
}

export interface VideoPost extends BasePost {
  readonly type: 'video'
  readonly video: Video
}

// A photo's width and height (in pixels) are read from the file when it's saved, so the page
// reserves the right space before it loads, and its URLs have a hash of its contents, so browsers
// can keep it for good. `srcset` has its resized copies, for an <img> with `sizes`. A photo that
// can't be read has none of these, and is shown as it is.
export interface Photo {
  readonly src: string
  readonly alt: string
  readonly width?: number | undefined
  readonly height?: number | undefined
  readonly srcset?: string | undefined
}

// A video's width and height are given in the post (they can't be read from the file), or else
// are its poster's. `poster` is the poster resized for the player, and `posterImage` the poster as
// it was uploaded, for link previews.
export interface Video {
  readonly src: string
  readonly poster?: string | undefined
  readonly posterImage?: string | undefined
  readonly width?: number | undefined
  readonly height?: number | undefined
}

// The card for the first link in a text post (see link-previews/link-previews.ts), with what the
// linked page shares about itself.
export interface LinkPreview {
  readonly url: string
  readonly domain: string
  readonly title?: string | undefined
  readonly description?: string | undefined
  // The saved copy of the link's image.
  readonly image?: Photo | undefined
  readonly smallImage?: boolean | undefined
}

// The size and version of one of a post's images, by file name.
export type ImageLookup = (file: string) => ImageInfo | undefined

// A stored post as pages show it. Without `image`, its photos have no sizes or versions.
// `fileUrl` is where its files are served: publicly, or for the composer's preview, from /admin.
export function toPost(
  post: PostRecord,
  image: ImageLookup = () => undefined,
  fileUrl: (id: string, file: string) => string = routes.postFile,
): Post {
  let src = (file: string) => fileUrl(post.id, file)
  let photo = ({ file, alt }: PhotoRecord): Photo => {
    let info = image(file)
    if (!info) return { src: src(file), alt }
    let { width, height, version } = info
    let srcset = getSrcset(src(file), file, info) || undefined
    return { src: `${src(file)}?v=${version}`, alt, width, height, srcset }
  }
  let base = {
    id: post.id,
    date: post.date,
    city: post.city,
    caption: post.caption,
    captionHtml: post.caption ? renderCaption(post.caption) : undefined,
  }

  switch (post.type) {
    case 'text':
      return { ...base, type: 'text', caption: post.caption }
    case 'photos':
      return { ...base, type: 'photos', photos: Arr.map(post.photos, photo) }
    case 'video': {
      let { file, poster, width, height } = post.video
      let info = poster ? image(poster) : undefined
      let video: { -readonly [K in keyof Video]: Video[K] } = { src: src(file), width, height }
      if (poster) {
        video.poster = info ? getPosterUrl(src(poster), poster, info) : src(poster)
        video.posterImage = info ? `${src(poster)}?v=${info.version}` : src(poster)
      }
      if (info && !(video.width && video.height)) {
        video.width = info.width
        video.height = info.height
      }
      return { ...base, type: 'video', video }
    }
  }
}

// A poster is shown full width, so it's resized to fit a 2x screen, as a <video> can't pick a
// size.
function getPosterUrl(url: string, name: string, info: ImageInfo): string {
  let sources = getImageSources(name, info)
  let source = sources.find((source) => source.param >= POSTER_WIDTH) ?? sources.at(-1)
  return source ? `${url}?w=${source.param}&v=${info.version}` : `${url}?v=${info.version}`
}

const POSTER_WIDTH = 1160

// What a page tells search engines and link previews about itself (see ../components/document.tsx).
export interface PageMeta {
  // Path of the page's canonical URL, like "/posts/fc7p7vjhx6".
  readonly path: string
  // Shown before the site title in the <title>; the home page has none.
  readonly title?: string | undefined
  readonly description?: string | undefined
  // Site-relative or absolute URL of the image shown when the page is shared.
  readonly image?: MetaImage | undefined
  // For posts: when it was published.
  readonly published?: string | undefined
  // Keeps the page out of search results (e.g. "not found" pages).
  readonly noindex?: boolean | undefined
}

interface MetaImage {
  readonly url: string
  readonly alt?: string | undefined
  readonly width?: number | undefined
  readonly height?: number | undefined
}

// What the post's page tells search engines and link previews: the start of the caption, and the
// first photo or the video's poster.
export function getPostMeta(post: Post): PageMeta {
  let text = post.caption ? captionText(post.caption) : ''
  let [firstLine = ''] = text.split('\n')
  let [photo] = post.type === 'photos' ? post.photos : []
  let image = photo
    ? { url: photo.src, alt: photo.alt, width: photo.width, height: photo.height }
    : post.type === 'video' && post.video.posterImage
      ? { url: post.video.posterImage, width: post.video.width, height: post.video.height }
      : undefined
  return {
    path: routes.post(post.id),
    title: clamp(firstLine, 60) || 'Post',
    description: clamp(text.replace(/\s+/g, ' '), 160) || undefined,
    image,
    published: post.date,
  }
}

// An image to preload, with the srcset and sizes of its <img> so the same copy is fetched.
export interface PreloadImage {
  readonly href: string
  readonly srcset?: string | undefined
  readonly sizes?: string | undefined
}

// The image that's likely the largest thing on screen when `post` is the first post shown (in
// the feed, or with `full` on the post's own page), for the document to preload: the first photo,
// or a video's poster.
export function getPriorityImage(post: Post, full = false): PreloadImage | undefined {
  switch (post.type) {
    case 'photos': {
      let [{ src, srcset }] = post.photos
      let inGrid = !full && post.photos.length > 1
      let sizes = inGrid ? HALF_WIDTH_IMAGE_SIZES : FULL_WIDTH_IMAGE_SIZES
      return { href: src, srcset, sizes: srcset ? sizes : undefined }
    }
    case 'video':
      return post.video.poster ? { href: post.video.poster } : undefined
    case 'text':
      return undefined
  }
}

// One line describing a post, for the admin's list: the caption's first line, else its media.
export function summarizePost(post: Post): string {
  let firstLine = post.caption ? captionText(post.caption).split('\n')[0] : ''
  if (firstLine) return firstLine
  if (post.type === 'photos') {
    return post.photos.length === 1 ? '1 photo' : `${post.photos.length} photos`
  }
  return 'Video'
}
