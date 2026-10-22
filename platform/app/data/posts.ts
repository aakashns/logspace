import * as path from 'node:path'
import * as s from 'remix/data-schema'
import type { InferOutput, Issue } from 'remix/data-schema'

import { routes } from '../routes.ts'
import { db } from './db.ts'
import { getImageSources, type ImageInfo } from './images.ts'
import {
  getPostFileKey,
  getPostImages,
  hasPostFile,
  isPostFileName,
  mediaStorage,
} from './media.ts'
import { posts as postsTable, toPostRecord } from './tables.ts'

// Posts are stored in the database (see db.ts), and their media in file storage (see media.ts).
// They're written and edited at /admin; their format is described in docs/posts.md.

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

// All posts, newest first.
export async function getPosts(): Promise<Post[]> {
  return loadPosts((await db.findMany(postsTable)).map(toPostRecord))
}

export async function getPost(id: string): Promise<Post | undefined> {
  let row = await db.find(postsTable, id)
  return row ? (await loadPosts([toPostRecord(row)]))[0] : undefined
}

// Posts from stored records, with their images' sizes and versions from media storage.
async function loadPosts(records: Record<string, unknown>[]) {
  let posts = validatePosts(records)
  let images = await getPostImages(
    posts.flatMap((post) =>
      getPostImageNames(post).map((name): [string, string] => [post.id, name]),
    ),
  )
  return sortPosts(posts.map((post) => resolvePost(post, images)))
}

// The images a post names: photos, an article's cover, or a video's poster.
function getPostImageNames(post: PostRecord): string[] {
  switch (post.type) {
    case 'photos':
      return post.photos.map((photo) => photo.file)
    case 'video':
      return post.video.poster ? [post.video.poster] : []
    case 'article':
      return post.article.cover ? [post.article.cover.file] : []
    case 'text':
      return []
  }
}

// The files a post names that aren't in media storage.
export async function findMissingPostFiles(post: Post, storage = mediaStorage) {
  let urls =
    post.type === 'photos'
      ? post.photos.map((photo) => photo.src)
      : post.type === 'video'
        ? [post.video.src, post.video.poster]
        : post.type === 'article'
          ? [post.article.cover?.src]
          : []
  let files = urls
    .filter((url) => url !== undefined)
    .map((url) => decodeURIComponent(path.posix.basename(url)))
  let found = await Promise.all(files.map((file) => hasPostFile(post.id, file, storage)))
  return files.filter((_, i) => !found[i])
}

export function getPostFileUrl(id: string, file: string) {
  return routes.posts.file.href({ id, file })
}

// Post ids are 10 lowercase letters and digits (see newPostId).
export function isPostId(id: unknown): id is string {
  return typeof id === 'string' && /^[0-9a-z]{10}$/.test(id)
}

// A new random post id, like `bun run new-id` makes.
export function newPostId() {
  let alphabet = '0123456789abcdefghijklmnopqrstuvwxyz'
  let id = ''
  while (id.length < 10) {
    let [byte] = crypto.getRandomValues(new Uint8Array(1))
    // 252 is the largest multiple of 36 that fits in a byte, so every character is equally likely.
    if (byte < 252) id += alphabet[byte % 36]
  }
  return id
}

// Validates one post, as the /admin post form submits it. On success it returns the record to
// store and the post it shows as.
export function parsePost(
  data: unknown,
):
  { success: true; record: PostRecord; post: Post } | { success: false; issues: readonly Issue[] } {
  let result = s.parseSafe(PostSchema, data, { errorMap })
  if (!result.success) return { success: false, issues: result.issues }
  return { success: true, record: result.value, post: resolvePost(result.value) }
}

// Validates a list of post records (as stored, see toPostRecord in tables.ts) and resolves media
// file names to URLs, without reading the images' sizes. Throws an error naming the offending post
// and field when something is wrong.
export function parsePosts(data: unknown): Post[] {
  return sortPosts(validatePosts(data).map((post) => resolvePost(post)))
}

function sortPosts(posts: Post[]) {
  return posts.toSorted((a, b) => Date.parse(b.date) - Date.parse(a.date))
}

function validatePosts(data: unknown): PostRecord[] {
  let result = s.parseSafe(PostsSchema, data, { errorMap })
  if (!result.success) {
    // Issues read like `post "my-post", date: Expected a date…`.
    let issues = result.issues.map((issue) => {
      let [index, ...fields] = (issue.path ?? []).map((key) =>
        typeof key === 'object' ? key.key : key,
      )
      let id = Array.isArray(data) && index !== undefined ? data[Number(index)]?.id : undefined
      let post =
        index === undefined
          ? ''
          : typeof id === 'string'
            ? `post "${id}"`
            : `post #${Number(index) + 1}`
      let where = [post, fields.join('.')].filter(Boolean).join(', ')
      return `  ${where ? `${where}: ` : ''}${issue.message}`
    })
    throw new Error(`Invalid posts:\n${issues.join('\n')}`)
  }
  return result.value
}

// `images` has the size and version of the post's images, by key in media storage (see
// getPostImages).
function resolvePost(post: PostRecord, images = new Map<string, ImageInfo>()): Post {
  let src = (file: string) => getPostFileUrl(post.id, file)
  let image = (file: string) => images.get(getPostFileKey(post.id, file))
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

// A poster is shown full width, so it's resized to fit a 2x screen, as a <video> can't pick a size.
function getPosterUrl(url: string, name: string, info: ImageInfo) {
  let sources = getImageSources(name, info)
  let source = sources.find((source) => source.param >= POSTER_WIDTH) ?? sources.at(-1)
  return source ? `${url}?w=${source.param}&v=${info.version}` : `${url}?v=${info.version}`
}

const POSTER_WIDTH = 1160

// The only numbers in a post are widths and heights.
function errorMap(context: { code: string }) {
  return context.code === 'type.number' ? 'Expected a size in pixels' : undefined
}

let fileName = s
  .string()
  .refine(isPostFileName, 'Expected the name of one of the post’s files, like "photo.jpg"')
let pixels = s.optional(
  s.number().refine((n) => Number.isInteger(n) && n > 0, 'Expected a size in pixels'),
)
let PhotoSchema = s.object({ file: fileName, alt: s.string() })
type PhotoRecord = InferOutput<typeof PhotoSchema>

let basePost = {
  id: s
    .string()
    .refine(
      isPostId,
      'Expected 10 lowercase letters and digits, like "fc7p7vjhx6" (see bun run new-id)',
    ),
  date: s
    .string()
    .refine(
      (date) =>
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/.test(date) &&
        !Number.isNaN(Date.parse(date)),
      'Expected a date like "2026-10-16T18:42:00+05:30"',
    ),
  city: s.optional(s.string()),
  caption: s.optional(s.string()),
}

let PostSchema = s.variant('type', {
  text: s.object({
    ...basePost,
    type: s.literal('text'),
    caption: s.string().refine((caption) => caption.trim() !== '', 'Text posts need a caption'),
  }),
  photos: s.object({
    ...basePost,
    type: s.literal('photos'),
    photos: s
      .array(PhotoSchema)
      .refine((photos) => photos.length > 0, 'Expected at least one photo'),
  }),
  video: s.object({
    ...basePost,
    type: s.literal('video'),
    video: s.object({
      file: fileName,
      poster: s.optional(fileName),
      width: pixels,
      height: pixels,
    }),
  }),
  article: s.object({
    ...basePost,
    type: s.literal('article'),
    article: s.object({
      title: s.string().refine((title) => title.trim() !== '', 'Articles need a title'),
      summary: s.string(),
      body: s.string().refine((body) => body.trim() !== '', 'Articles need a body'),
      cover: s.optional(PhotoSchema),
    }),
  }),
})
type PostRecord = InferOutput<typeof PostSchema>

let PostsSchema = s
  .array(PostSchema)
  .refine(
    (posts) => new Set(posts.map((post) => post.id)).size === posts.length,
    'Every post needs a unique id',
  )
