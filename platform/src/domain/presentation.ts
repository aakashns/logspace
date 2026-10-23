// Posts as pages show them, with their media's URLs and their captions rendered. Pure: the read
// model (../queries/posts.ts) makes these from stored posts once per change, so pages only render.
import { routes } from '../routes.ts'
import { FULL_WIDTH_IMAGE_SIZES, HALF_WIDTH_IMAGE_SIZES } from './constants.ts'
import { clamp } from './format.ts'
import { getImageSources, getSrcset, type ImageInfo } from './images.ts'
import { captionText, renderCaption } from './markdown.ts'
import type { PhotoRecord, PostRecord } from './post.ts'

export type Post = TextPost | PhotosPost | VideoPost | ArticlePost

interface BasePost {
  readonly id: string
  // ISO 8601 with the UTC offset of where it was posted; the post shows that local time.
  readonly date: string
  readonly city?: string
  readonly caption?: string
  // The caption as HTML (see renderCaption).
  readonly captionHtml?: string
}

export interface TextPost extends BasePost {
  readonly type: 'text'
  readonly caption: string
}

export interface PhotosPost extends BasePost {
  readonly type: 'photos'
  readonly photos: readonly Photo[]
}

export interface VideoPost extends BasePost {
  readonly type: 'video'
  readonly video: Video
}

export interface ArticlePost extends BasePost {
  readonly type: 'article'
  // The body is Markdown (see renderArticle).
  readonly article: {
    readonly title: string
    readonly summary: string
    readonly body: string
    readonly cover?: Photo
  }
}

// A photo's width and height (in pixels) are read from the file when it's saved, so the page
// reserves the right space before it loads, and its URLs have a hash of its contents, so browsers
// can keep it for good. `srcset` has its resized copies, for an <img> with `sizes`. A photo that
// can't be read has none of these, and is shown as it is.
export interface Photo {
  readonly src: string
  readonly alt: string
  readonly width?: number
  readonly height?: number
  readonly srcset?: string
}

// A video's width and height are given in the post (they can't be read from the file), or else
// are its poster's. `poster` is the poster resized for the player, and `posterImage` the poster as
// it was uploaded, for link previews.
export interface Video {
  readonly src: string
  readonly poster?: string
  readonly posterImage?: string
  readonly width?: number
  readonly height?: number
}

// The size and version of one of a post's images, by file name.
export type ImageLookup = (file: string) => ImageInfo | undefined

// A stored post as pages show it. Without `image`, its photos have no sizes or versions.
export function toPost(post: PostRecord, image: ImageLookup = () => undefined): Post {
  let src = (file: string) => routes.postFile(post.id, file)
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
      return { ...base, type: 'photos', photos: post.photos.map(photo) }
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
    case 'article': {
      let { title, summary, body, cover } = post.article
      return {
        ...base,
        type: 'article',
        article: { title, summary, body, cover: cover && photo(cover) },
      }
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

// What a page tells search engines and link previews about itself (see views/document.tsx).
export interface PageMeta {
  // Path of the page's canonical URL, like "/posts/fc7p7vjhx6".
  readonly path: string
  // Shown before the site title in the <title>; the home page has none.
  readonly title?: string
  readonly description?: string
  // Site-relative or absolute URL of the image shown when the page is shared.
  readonly image?: { url: string; alt?: string; width?: number; height?: number }
  // For posts: when it was published, and the kind of schema.org object it is.
  readonly published?: { date: string; kind: 'BlogPosting' | 'SocialMediaPosting' }
  // Keeps the page out of search results (e.g. "not found" pages).
  readonly noindex?: boolean
}

// What the post's page tells search engines and link previews: an article's title, summary, and
// cover, or for other posts the start of the caption and the first photo or the video's poster.
export function getPostMeta(post: Post): PageMeta {
  let path = routes.post(post.id)
  let text = post.caption ? captionText(post.caption).trim() : ''
  let caption = text.replace(/\s+/g, ' ')
  let firstLine = text.split('\n')[0]
  let published = {
    date: post.date,
    kind: post.type === 'article' ? ('BlogPosting' as const) : ('SocialMediaPosting' as const),
  }

  if (post.type === 'article') {
    let { title, summary, cover } = post.article
    return { path, title, description: summary, image: cover && toImage(cover), published }
  }

  let image =
    post.type === 'photos'
      ? toImage(post.photos[0])
      : post.type === 'video' && post.video.posterImage
        ? { url: post.video.posterImage, width: post.video.width, height: post.video.height }
        : undefined
  return {
    path,
    title: clamp(firstLine, 60) || 'Post',
    description: clamp(caption, 160) || undefined,
    image,
    published,
  }
}

function toImage(photo: Photo): PageMeta['image'] {
  return { url: photo.src, alt: photo.alt, width: photo.width, height: photo.height }
}

// An image to preload, with the srcset and sizes of its <img> so the same copy is fetched.
export interface PreloadImage {
  readonly href: string
  readonly srcset?: string
  readonly sizes?: string
}

// The image that's likely the largest thing on screen when `post` is the first post shown (in
// the feed, or with `full` on the post's own page), for the document to preload: the first photo,
// an article's cover, or a video's poster.
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

// One line describing a post, for the admin's list: an article's title, else the caption's first
// line, else its media.
export function summarizePost(post: Post): string {
  if (post.type === 'article') return post.article.title
  let firstLine = post.caption ? captionText(post.caption).trim().split('\n')[0] : ''
  if (firstLine) return firstLine
  if (post.type === 'photos') {
    return post.photos.length === 1 ? '1 photo' : `${post.photos.length} photos`
  }
  return 'Video'
}
