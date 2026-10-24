// What the /admin post form submits and shows. The form itself is views/admin/post-form.tsx.
import { isUploadableFileName, type PostIssue } from './post.ts'

// A post as the form shows it: the format of a PostRecord, except that what was typed is kept as
// is (a width can be "abc") so a rejected submission comes back unchanged.
export type PostFormValues = {
  readonly id: string
  readonly type: string
  readonly date: string
  readonly city?: string
  readonly caption?: string
  readonly photos?: readonly PhotoValues[]
  readonly video?: {
    readonly file?: string
    readonly poster?: string
    readonly width?: number | string
    readonly height?: number | string
  }
}

// A photo's size is read from its file, so only a video has width and height fields.
export interface PhotoValues {
  readonly file?: string
  readonly alt?: string
}

// A submitted post form: the post, the files chosen with it, and problems already found.
export interface PostForm {
  post: PostFormValues
  uploads: { name: string; file: File }[]
  issues: PostIssue[]
}

// Reads a submitted edit post form. Only the fields of the post's `type` are kept, since a post's
// type can't change. A media field is a file name, or a file chosen next to it, which `uploads`
// has and whose name the field takes; `issues` has the chosen files that can't be uploaded.
export function readPostForm(formData: FormData, id: string, type: string): PostForm {
  let text = (name: string) => {
    let value = formData.get(name)
    // Browsers send textarea line breaks as \r\n.
    return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : ''
  }
  let optional = (name: string) => text(name) || undefined
  // A size is a number when it looks like one, else what was typed, for the schema to reject.
  let size = (value: string) =>
    value === '' ? undefined : /^\d+$/.test(value) ? Number(value) : value

  let uploads: PostForm['uploads'] = []
  let issues: PostIssue[] = []
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

  // The date is typed in UTC; datetime-local leaves out the seconds when they're zero.
  let date = text('date')
  if (/T\d{2}:\d{2}$/.test(date)) date += ':00'
  let city = optional('city')
  let caption = optional('caption')
  let base = {
    id,
    type,
    date: date + 'Z',
    ...(city !== undefined && { city }),
    ...(caption !== undefined && { caption }),
  }

  let readPost = (): PostFormValues => {
    switch (type) {
      case 'text':
        // Kept even when empty, so the error says that text posts need one.
        return { ...base, caption: caption ?? '' }
      case 'photos': {
        let all = (name: string) => formData.getAll(name).map((value) => String(value).trim())
        let alts = all('photo_alt')
        // Every row has a file input, so they line up with the rows.
        let rowUploads = formData.getAll('photo_upload')
        let rows = all('photo_file').map((file, i) => ({
          file: upload(rowUploads[i]) ?? file,
          alt: alts[i] ?? '',
        }))
        // Photos added several at once go after the rest, without alt text.
        let added = formData
          .getAll('photo_uploads')
          .map((value) => ({ file: upload(value) ?? '', alt: '' }))
        return {
          ...base,
          photos: [...rows, ...added].filter((photo) => photo.file !== ''),
        }
      }
      case 'video': {
        let videoFile = upload(formData.get('video_upload')) ?? text('video_file')
        let poster = upload(formData.get('video_poster_upload')) ?? optional('video_poster')
        let width = size(text('video_width'))
        let height = size(text('video_height'))
        return {
          ...base,
          video: {
            file: videoFile,
            ...(poster !== undefined && { poster }),
            ...(width !== undefined && { width }),
            ...(height !== undefined && { height }),
          },
        }
      }
      default:
        return base
    }
  }
  return { post: readPost(), uploads, issues }
}

// The name an uploaded file is saved under: its own, without any folders (some browsers send
// them), and with dashes for spaces, so its URL reads cleanly.
export function uploadName(name: string): string {
  return (name.split(/[\\/]/).pop() ?? '').trim().replace(/\s+/g, '-')
}

// aria-invalid for a field: "true" when one of the issues is about it.
export type InvalidCheck = (field: string) => 'true' | undefined

export function invalidCheck(issues: readonly PostIssue[]): InvalidCheck {
  return (field) => (issues.some((issue) => issue.field === field) ? 'true' : undefined)
}
