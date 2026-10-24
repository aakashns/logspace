// What a post is made of, and the checks a post goes through before it's stored. Pure: storing
// posts is in ../commands and ../queries, showing them in presentation.ts.
import { Array as Arr, Result, Schema } from 'effect'

import { toIssues, type Issue } from '../lib/issues.ts'

export const POST_TYPES = ['text', 'photos', 'video'] as const
export type PostType = (typeof POST_TYPES)[number]

// A problem with a post. `field` is the path to the value, like "photos.0.file".
export type PostIssue = Issue

// Post ids are 10 lowercase letters and digits (see newPostId).
export function isPostId(id: unknown): id is string {
  return typeof id === 'string' && /^[0-9a-z]{10}$/.test(id)
}

// A new random post id.
export function newPostId(): string {
  let alphabet = '0123456789abcdefghijklmnopqrstuvwxyz'
  let id = ''
  while (id.length < 10) {
    for (let byte of crypto.getRandomValues(new Uint8Array(10 - id.length))) {
      // 252 is the largest multiple of 36 that fits in a byte, so every character is equally
      // likely.
      if (byte < 252) id += alphabet.charAt(byte % 36)
    }
  }
  return id
}

// Whether `name` can be a file of a post: no paths, no hidden files. Every key in media storage
// is built from a post id and a name that passed this, so none can leave its folder.
export function isPostFileName(name: string): boolean {
  return /^[^./\\][^/\\]*$/.test(name)
}

// A file's type, from its extension, which is what it's served as. Undefined without one. Bun's
// table, but with LogSpace 0.1's types for the photo and video formats Bun doesn't know or types
// differently (it has .ts and .mts as JavaScript, which as videos are MPEG transport streams).
export function mimeType(name: string): string | undefined {
  let extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  if (name.includes('.') && Object.hasOwn(MEDIA_TYPES, extension)) return MEDIA_TYPES[extension]
  let type = Bun.file(name).type
  return type === 'application/octet-stream' ? undefined : type
}

const MEDIA_TYPES: Record<string, string> = {
  jfif: 'image/pjpeg',
  jxl: 'image/jxl',
  dng: 'image/x-adobe-dng',
  bmp: 'image/bmp',
  ts: 'video/mp2t',
  mts: 'video/mp2t',
  m2ts: 'video/mp2t',
}

// Whether a file by this name can be uploaded as one of a post's files: photos and videos only,
// since files are served inline from the site's own origin. SVG is left out because it can run
// scripts.
export function isUploadableFileName(name: string): boolean {
  let type = mimeType(name)
  return (
    isPostFileName(name) &&
    (type?.startsWith('video/') === true ||
      (type?.startsWith('image/') === true && type !== 'image/svg+xml'))
  )
}

const message = (text: string) => ({ message: text })
const valid = <T>(check: (value: T) => boolean, text: string) =>
  Schema.makeFilter(check, message(text))

export const FileName = Schema.String.check(
  valid(isPostFileName, 'Expected the name of one of the post’s files, like "photo.jpg"'),
)
// The only numbers in a post are a video's width and height.
const Pixels = Schema.Number.annotate(message('Expected a size in pixels')).check(
  valid((n: number) => Number.isInteger(n) && n > 0, 'Expected a size in pixels'),
)

export const PhotoRecord = Schema.Struct({ file: FileName, alt: Schema.String })
export type PhotoRecord = typeof PhotoRecord.Type

const basePost = {
  id: Schema.String.check(
    valid(isPostId, 'Expected 10 lowercase letters and digits, like "fc7p7vjhx6"'),
  ),
  // When it was posted, in UTC, to the second.
  date: Schema.String.check(
    valid(
      (date: string) =>
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(date) && !Number.isNaN(Date.parse(date)),
      'Expected a UTC date like "2026-10-16T13:12:00Z"',
    ),
  ),
  city: Schema.optionalKey(Schema.String),
  caption: Schema.optionalKey(Schema.String),
}

const TextPost = Schema.Struct({
  ...basePost,
  type: Schema.Literal('text'),
  caption: Schema.String.check(
    valid((caption: string) => caption.trim() !== '', 'Text posts need a caption'),
  ),
})

const PhotosPost = Schema.Struct({
  ...basePost,
  type: Schema.Literal('photos'),
  photos: Schema.Array(PhotoRecord).pipe(
    Schema.refine(Arr.isReadonlyArrayNonEmpty, message('Expected at least one photo')),
  ),
})

const VideoPost = Schema.Struct({
  ...basePost,
  type: Schema.Literal('video'),
  // A video's size is given here, since it can't be read from the file; else it's its poster's.
  video: Schema.Struct({
    file: FileName,
    poster: Schema.optionalKey(FileName),
    width: Schema.optionalKey(Pixels),
    height: Schema.optionalKey(Pixels),
  }),
})

// A valid post, as it's stored: its media are named by their files.
export type PostRecord = typeof PostRecord.Type
export const PostRecord = Schema.Union([TextPost, PhotosPost, VideoPost])

// The type is checked first, so a post of no known type gets one issue about it, rather than one
// for each type it might have been. The union then checks only the fields of the post's type.
const TYPE_MESSAGE = 'Expected text, photos, or video'
const decodeType = Schema.decodeUnknownResult(
  Schema.Struct({
    type: Schema.Literals(POST_TYPES)
      .annotate(message(TYPE_MESSAGE))
      .annotateKey({ messageMissingKey: TYPE_MESSAGE }),
  }),
)
const decodePost = Schema.decodeUnknownResult(PostRecord, { errors: 'all' })

// Checks one post, as the /admin post form submits it, reporting every problem at once.
export function parsePostRecord(data: unknown): Result.Result<PostRecord, PostIssue[]> {
  return decodeType(data).pipe(
    Result.flatMap(() => decodePost(data)),
    Result.mapError((error) => toIssues(error.issue)),
  )
}

// The files a post names: photos, or a video and its poster.
export function getPostFileNames(post: PostRecord): string[] {
  switch (post.type) {
    case 'photos':
      return post.photos.map((photo) => photo.file)
    case 'video':
      return post.video.poster ? [post.video.file, post.video.poster] : [post.video.file]
    case 'text':
      return []
  }
}

export function sortNewestFirst<T extends { readonly date: string }>(posts: readonly T[]): T[] {
  return posts.toSorted((a, b) => Date.parse(b.date) - Date.parse(a.date))
}
