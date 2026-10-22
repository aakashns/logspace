import { captionText } from '../../lib/caption.ts'
import type { PageMeta } from '../../lib/page-meta.ts'
import { routes } from '../../routes.ts'
import { getImageSources, type ImageInfo } from '../image-sources.ts'
import type { PhotoRecord, PostRecord } from './model.ts'

// Posts as pages show them, with their media's URLs. This module is pure: store.ts loads posts
// with their images' sizes.

export type Post = TextPost | PhotosPost | VideoPost | ArticlePost

interface BasePost {
  id: string
  // ISO 8601 with the UTC offset of where it was posted; the post shows that local time.
  date: string
  city?: string
  caption?: string
}

export interface TextPost extends BasePost {
  type: 'text'
  caption: string
}

export interface PhotosPost extends BasePost {
  type: 'photos'
  photos: Photo[]
}

export interface VideoPost extends BasePost {
  type: 'video'
  video: Video
}

export interface ArticlePost extends BasePost {
  type: 'article'
  // The body is Markdown (see article.ts).
  article: { title: string; summary: string; body: string; cover?: Photo }
}

// Media URLs are resolved from the names of the post's files in media storage. A photo's width and
// height (in pixels) are read from the file, so the page reserves the right space before it loads,
// and its URLs have a hash of its contents, so browsers can keep it for good (see the file action in
// app/actions/posts/controller.tsx). `srcset` has its resized copies, for an <img> with `sizes`.
// A photo that can't be read has none of these, and is shown as it is.
export interface Photo {
  src: string
  alt: string
  width?: number
  height?: number
  srcset?: string
}

// A video's width and height are given in the post (sharp can't read videos), or else are its
// poster's. `poster` is the poster resized for the player, and `posterImage` the poster as it was
// uploaded, for link previews.
export interface Video {
  src: string
  poster?: string
  posterImage?: string
  width?: number
  height?: number
}

// The size and version of one of a post's images, by file name (see getPostImages in media.ts).
export type ImageLookup = (file: string) => ImageInfo | undefined

export function getPostFileUrl(id: string, file: string) {
  return routes.posts.file.href({ id, file })
}

// A stored post as pages show it. Without `image`, its photos have no sizes or versions.
export function toPost(post: PostRecord, image: ImageLookup = () => undefined): Post {
  let src = (file: string) => getPostFileUrl(post.id, file)
  let photo = ({ file, ...rest }: PhotoRecord): Photo => {
    let info = image(file)
    if (!info) return { ...rest, src: src(file) }
    let { width, height, version } = info
    let srcset = getImageSources(file, info)
      .map((source) => `${src(file)}?w=${source.param}&v=${version} ${source.width}w`)
      .join(', ')
    return { ...rest, src: `${src(file)}?v=${version}`, width, height, srcset: srcset || undefined }
  }

  switch (post.type) {
    case 'text':
      return post
    case 'photos':
      return { ...post, photos: post.photos.map(photo) }
    case 'video': {
      let { file, poster, ...rest } = post.video
      let info = poster ? image(poster) : undefined
      let video: Video = { ...rest, src: src(file) }
      if (poster) {
        video.poster = info ? getPosterUrl(src(poster), poster, info) : src(poster)
        video.posterImage = info ? `${src(poster)}?v=${info.version}` : src(poster)
      }
      if (info && !(video.width && video.height)) {
        video.width = info.width
        video.height = info.height
      }
      return { ...post, video }
    }
    case 'article': {
      let { cover, ...rest } = post.article
      return { ...post, article: { ...rest, cover: cover && photo(cover) } }
    }
  }
}

// What the post's page tells search engines and link previews: an article's title, summary, and
// cover, or for other posts the start of the caption and the first photo or the video's poster.
export function getPostMeta(post: Post): PageMeta {
  let path = routes.posts.show.href({ id: post.id })
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

// A poster is shown full width, so it's resized to fit a 2x screen, as a <video> can't pick a size.
function getPosterUrl(url: string, name: string, info: ImageInfo) {
  let sources = getImageSources(name, info)
  let source = sources.find((source) => source.param >= POSTER_WIDTH) ?? sources.at(-1)
  return source ? `${url}?w=${source.param}&v=${info.version}` : `${url}?v=${info.version}`
}

const POSTER_WIDTH = 1160

function toImage(photo: Photo): PageMeta['image'] {
  return { url: photo.src, alt: photo.alt, width: photo.width, height: photo.height }
}

function clamp(text: string, length: number) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text
}
