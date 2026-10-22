import { isUploadableFileName, savePostFile } from '../../../data/media.ts'
import { findMissingPostFiles, parsePost } from '../../../data/posts.ts'

// What the post form submits and shows, and the checks it goes through. The form itself is
// post-form.tsx.

// A post as the form shows it: the format of docs/posts.md, except that what was typed is kept as
// is (a width can be "abc") so a rejected submission comes back unchanged.
export interface PostFormValues {
  id: string
  type: string
  date: string
  city?: string
  caption?: string
  photos?: PhotoValues[]
  video?: { file?: string; poster?: string; width?: number | string; height?: number | string }
  article?: { title?: string; summary?: string; body?: string; cover?: PhotoValues }
}

// A photo's size is read from its file, so only a video has width and height fields.
export interface PhotoValues {
  file?: string
  alt?: string
}

// A file chosen in the form, to be saved as one of the post's files under `name`.
export interface Upload {
  name: string
  file: File
}

// A problem with a submission. `field` is the path to the value, like "photos.0.file".
export interface FormIssue {
  field?: string
  message: string
}

export const POST_TYPES = ['text', 'photos', 'video', 'article'] as const

// Reads a submitted post form. Only the fields of the post's type are kept: `type` for a post that
// already exists, since a post's type can't change, else the one chosen in the form. A media field
// is a file name, or a file chosen next to it, which `uploads` has for savePostUploads and whose
// name the field takes; `issues` has the chosen files that can't be uploaded.
export function readPostForm(
  formData: FormData,
  id: string,
  type?: string,
): { values: PostFormValues; uploads: Upload[]; issues: FormIssue[] } {
  let raw = (name: string) => {
    let value = formData.get(name)
    // Browsers send textarea line breaks as \r\n.
    return typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : ''
  }
  let text = (name: string) => raw(name).trim()
  let optional = (name: string) => text(name) || undefined
  // Markdown is kept as typed, since leading spaces can matter (four start a code block, and an
  // indented code fence strips that much from its lines); only a blank value counts as empty.
  let markdown = (name: string) => {
    let value = raw(name)
    return value.trim() === '' ? undefined : value
  }
  // A size is a number when it looks like one, else what was typed, for the schema to reject.
  let size = (value: string) =>
    value === '' ? undefined : /^\d+$/.test(value) ? Number(value) : value

  let uploads: Upload[] = []
  let issues: FormIssue[] = []
  // The name a chosen file is saved under, or undefined if no file was chosen (a file input left
  // empty sends an empty file) or it can't be uploaded.
  let upload = (value: FormDataEntryValue | null | undefined) => {
    if (!(value instanceof File) || value.size === 0) return undefined
    let name = uploadName(value.name)
    if (!isUploadableFileName(name)) {
      issues.push({
        message: `“${value.name}” can’t be uploaded: only photos and videos can, like .jpg, .png, or .mp4 files.`,
      })
      return undefined
    }
    if (uploads.some((other) => other.name === name)) {
      issues.push({
        message: `More than one of the chosen files is named “${name}”. Rename one and choose it again.`,
      })
      return undefined
    }
    uploads.push({ name, file: value })
    return name
  }
  let file = (prefix: string) => upload(formData.get(`${prefix}upload`)) ?? text(`${prefix}file`)

  let local = text('date')
  // datetime-local leaves out the seconds when they're zero.
  if (/T\d{2}:\d{2}$/.test(local)) local += ':00'
  let values: PostFormValues = {
    id,
    type: type ?? text('type'),
    date: local + text('offset'),
    city: optional('city'),
    caption: markdown('caption'),
  }

  switch (values.type) {
    case 'text':
      // Kept even when empty, so the error says that text posts need one.
      values.caption ??= ''
      break
    case 'photos': {
      let all = (name: string) => formData.getAll(name).map((value) => String(value).trim())
      let [files, alts] = ['file', 'alt'].map((field) => all(`photo_${field}`))
      // Every row has a file input, so they line up with the rows.
      let rowUploads = formData.getAll('photo_upload')
      let rows = files.map((file, i) => ({
        file: upload(rowUploads[i]) ?? file,
        alt: alts[i] ?? '',
      }))
      // Photos added several at once go after the rest, without alt text.
      let added = formData
        .getAll('photo_uploads')
        .map((value) => ({ file: upload(value) ?? '', alt: '' }))
      values.photos = [...rows, ...added].filter((photo) => photo.file !== '')
      break
    }
    case 'video':
      values.video = {
        file: file('video_'),
        poster: upload(formData.get('video_poster_upload')) ?? optional('video_poster'),
        width: size(text('video_width')),
        height: size(text('video_height')),
      }
      break
    case 'article': {
      let cover = { file: file('cover_'), alt: text('cover_alt') }
      values.article = {
        title: text('article_title'),
        summary: text('article_summary'),
        body: markdown('article_body') ?? '',
        cover: cover.file ? cover : undefined,
      }
      // Files for the body are named in its Markdown rather than in a field.
      for (let value of formData.getAll('article_uploads')) upload(value)
      break
    }
  }
  return { values: stripUndefined(values), uploads, issues }
}

// Saves the files chosen in a submission as the post's files, replacing any of the same names.
// They're saved even when the post isn't, so a rejected submission doesn't need its files chosen
// again: the form comes back with their names filled in.
export async function savePostUploads(id: string, uploads: Upload[]) {
  for (let { name, file } of uploads) await savePostFile(id, name, file)
}

// Checks a submitted post against the post format, and that every file it names is in media
// storage. `uploadIssues` are readPostForm's. On success it returns the record to store.
export async function validatePostForm(values: PostFormValues, uploadIssues: FormIssue[] = []) {
  let parsed = parsePost(values)
  if (!parsed.success) {
    let issues: FormIssue[] = parsed.issues.map((issue) => ({
      field: issue.path?.map((key) => String(typeof key === 'object' ? key.key : key)).join('.'),
      message: issue.message,
    }))
    return { success: false as const, issues: [...uploadIssues, ...issues] }
  }
  let missing = await findMissingPostFiles(parsed.post)
  let issues: FormIssue[] = [
    ...uploadIssues,
    ...missing.map((file) => ({
      message: `${file} isn’t one of this post’s files. Choose the file to upload it, or check the name.`,
    })),
  ]
  if (issues.length > 0) return { success: false as const, issues }
  return { success: true as const, record: parsed.record }
}

// The name an uploaded file is saved under: its own, without any folders (some browsers send
// them), and with dashes for spaces, since Markdown can't name a file with spaces in it.
function uploadName(name: string) {
  return (name.split(/[\\/]/).pop() ?? '').trim().replace(/\s+/g, '-')
}

// The form's starting date for a new post: now, at the UTC offset of the newest post, which is
// most likely where the next one is written.
export function newPostDate(newestDate: string | undefined) {
  let offset = newestDate?.match(/[+-]\d{2}:\d{2}$/)?.[0] ?? '+00:00'
  let [hours, minutes] = offset.slice(1).split(':').map(Number)
  let sign = offset.startsWith('-') ? -1 : 1
  let local = new Date(Date.now() + sign * (hours * 60 + minutes) * 60_000)
  return local.toISOString().slice(0, 16) + ':00' + offset
}

// aria-invalid for a field: "true" when one of the issues is about it.
export type InvalidCheck = (field: string) => 'true' | undefined

export function invalidCheck(issues: FormIssue[]): InvalidCheck {
  return (field) => (issues.some((issue) => issue.field === field) ? 'true' : undefined)
}

function stripUndefined<T extends object>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}
