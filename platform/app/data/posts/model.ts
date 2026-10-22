import * as s from 'remix/data-schema'
import type { InferOutput, Issue } from 'remix/data-schema'
import { detectMimeType } from 'remix/mime'

// What a post is made of (described in docs/posts.md), and the checks a post goes through before
// it's stored. This module is pure: storing posts is store.ts, and showing them presentation.ts.

// A valid post, as it's stored: its media are named by their files (see isPostFileName).
export type PostRecord = InferOutput<typeof PostSchema>
export type PhotoRecord = InferOutput<typeof PhotoSchema>

// A problem with a post. `field` is the path to the value, like "photos.0.file".
export interface PostIssue {
  field?: string
  message: string
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

// Whether `name` can be a file of a post (no paths, no hidden files).
export function isPostFileName(name: string) {
  return /^[^./\\][^/\\]*$/.test(name)
}

// Whether a file by this name can be uploaded as one of a post's files: photos and videos only,
// since files are served inline from the site's own origin. SVG is left out because it can run
// scripts.
export function isUploadableFileName(name: string) {
  let type = detectMimeType(name)
  return (
    isPostFileName(name) &&
    (type?.startsWith('video/') || (type?.startsWith('image/') && type !== 'image/svg+xml')) ===
      true
  )
}

// Checks one post, as the /admin post form submits it.
export function parsePostRecord(
  data: unknown,
): { success: true; record: PostRecord } | { success: false; issues: PostIssue[] } {
  let result = s.parseSafe(PostSchema, data, { errorMap })
  if (result.success) return { success: true, record: result.value }
  let issues = result.issues.map((issue) => {
    let path = issuePath(issue)
    return { field: path.length > 0 ? path.join('.') : undefined, message: issue.message }
  })
  return { success: false, issues }
}

// Checks posts as they're stored. Throws an error naming the offending post and field when
// something is wrong, since stored posts were checked when they were saved.
export function parsePostRecords(data: unknown[]): PostRecord[] {
  return data.map((post, index) => {
    let result = parsePostRecord(post)
    if (result.success) return result.record
    let id = (post as { id?: unknown } | null)?.id
    let name = typeof id === 'string' ? `post "${id}"` : `post #${index + 1}`
    // Issues read like `post "my-post", date: Expected a date…`.
    let issues = result.issues.map((issue) => {
      return `  ${[name, issue.field].filter(Boolean).join(', ')}: ${issue.message}`
    })
    throw new Error(`Invalid posts:\n${issues.join('\n')}`)
  })
}

// The files a post names: photos, an article's cover, or a video and its poster. An article's
// body can name more, in its Markdown.
export function getPostFileNames(post: PostRecord): string[] {
  switch (post.type) {
    case 'photos':
      return post.photos.map((photo) => photo.file)
    case 'video':
      return post.video.poster ? [post.video.file, post.video.poster] : [post.video.file]
    case 'article':
      return post.article.cover ? [post.article.cover.file] : []
    case 'text':
      return []
  }
}

export function sortNewestFirst<T extends { date: string }>(posts: T[]) {
  return posts.toSorted((a, b) => Date.parse(b.date) - Date.parse(a.date))
}

function issuePath(issue: Issue) {
  return (issue.path ?? []).map((key) => String(typeof key === 'object' ? key.key : key))
}

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

let basePost = {
  id: s
    .string()
    .refine(
      isPostId,
      'Expected 10 lowercase letters and digits, like "fc7p7vjhx6" (see bun run new-id)',
    ),
  // ISO 8601 with the UTC offset of where it was posted; the post shows that local time.
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
    // A video's size is given here, since sharp can't read videos; else it's its poster's.
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
    // The body is Markdown (see article.ts).
    article: s.object({
      title: s.string().refine((title) => title.trim() !== '', 'Articles need a title'),
      summary: s.string(),
      body: s.string().refine((body) => body.trim() !== '', 'Articles need a body'),
      cover: s.optional(PhotoSchema),
    }),
  }),
})
