// What the composer at /admin/posts/new submits: a caption, and photos or a video (with an
// optional poster). The post's type follows from its media, and a photo's alt text is its file
// name. Media is uploaded as it's chosen, so each submission lists what was added before (in
// hidden fields) and any files chosen with it. Nothing is kept on the server until it's posted.
// The form is views/admin/compose.tsx.
import { Array as Arr } from 'effect'

import {
  isPostFileName,
  isUploadableFileName,
  mimeType,
  type PostIssue,
  type PostRecord,
} from './post.ts'
import { uploadName } from './post-form.ts'

export interface ComposeValues {
  readonly id: string
  // Markdown, as typed.
  readonly caption: string
  readonly photos: readonly string[]
  readonly video?: string | undefined
  readonly poster?: string | undefined
}

// A submitted composer: what it holds, the files chosen with it (already named in `values`), and
// the chosen files that couldn't be added.
export interface ComposeForm {
  values: ComposeValues
  uploads: { name: string; file: File }[]
  issues: PostIssue[]
}

// Reads a submitted composer. `remove` names a file to take out (the button on its tile sends
// it); the video's poster goes with it. Images chosen are photos, or with a video, its poster. A
// chosen file whose name the post already uses gets a number added (photo.jpg, photo-2.jpg),
// since phones often name every photo alike. A post has photos or a video, not both.
export function readComposeForm(formData: FormData): ComposeForm {
  let text = (name: string) => {
    let value = formData.get(name)
    // Browsers send textarea line breaks as \r\n.
    return typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : ''
  }
  let remove = text('remove')
  let fileNames = (name: string) =>
    formData
      .getAll(name)
      .flatMap((value) =>
        typeof value === 'string' && isPostFileName(value.trim()) ? [value.trim()] : [],
      )
      .filter((file) => file !== remove)
  // A file input left empty sends an empty file.
  let chosen = (name: string) =>
    formData.getAll(name).filter((value) => value instanceof File && value.size > 0)

  let photos = fileNames('photo')
  let [video] = fileNames('video')
  let [poster] = video ? fileNames('poster') : []
  let issues: PostIssue[] = []
  let uploads: ComposeForm['uploads'] = []
  let taken = new Set([...photos, video, poster])
  let upload = (value: FormDataEntryValue, type: 'image' | 'video') => {
    if (!(value instanceof File)) return undefined
    let name = uploadName(value.name)
    if (!isUploadableFileName(name) || !mimeType(name)?.startsWith(`${type}/`)) {
      let expected =
        type === 'image' ? 'photos, like .jpg or .png files' : 'videos, like .mp4 files'
      issues.push({ message: `“${value.name}” can’t be added here: only ${expected} can.` })
      return undefined
    }
    name = unusedName(name, taken)
    taken.add(name)
    uploads.push({ name, file: value })
    return name
  }

  let [videoFile] = chosen('video_upload')
  if (videoFile && photos.length > 0) {
    issues.push({
      message: 'A post can have photos or a video, not both. Remove the photos first.',
    })
  } else if (videoFile) {
    video = upload(videoFile, 'video') ?? video
  }
  let images = chosen('image_uploads')
  if (video) {
    let [posterFile] = images
    if (posterFile) poster = upload(posterFile, 'image') ?? poster
  } else {
    for (let file of images) {
      let name = upload(file, 'image')
      if (name) photos.push(name)
    }
  }

  return {
    values: { id: text('post_id').trim(), caption: text('caption'), photos, video, poster },
    uploads,
    issues,
  }
}

// `name`, or with -2, -3, … before its extension, whichever isn't taken.
function unusedName(name: string, taken: ReadonlySet<string | undefined>): string {
  let dot = name.lastIndexOf('.')
  let [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  let candidate = name
  for (let n = 2; taken.has(candidate); n++) candidate = `${stem}-${n}${extension}`
  return candidate
}

// The post the composer makes, dated `date`. It isn't checked: publishing checks it, and the
// preview shows it as it is.
export function composePost(values: ComposeValues, date: string): PostRecord {
  let { id, photos, video, poster } = values
  // Markdown is kept as typed, since leading spaces can matter; only a blank caption is none.
  let caption = values.caption.trim() === '' ? undefined : values.caption
  let base = { id, date, ...(caption !== undefined && { caption }) }
  if (video) {
    return { ...base, type: 'video', video: { file: video, ...(poster && { poster }) } }
  }
  if (Arr.isReadonlyArrayNonEmpty(photos)) {
    return { ...base, type: 'photos', photos: Arr.map(photos, (file) => ({ file, alt: file })) }
  }
  return { ...base, type: 'text', caption: caption ?? '' }
}
