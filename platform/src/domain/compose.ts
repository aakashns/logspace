// What the composer submits, for a new post or an edit: a caption, and photos or a video (with
// an optional poster). The post's type follows from its media, and a new photo's alt text is its
// file name. Media is uploaded as it's chosen, so each submission lists what was added before (in
// hidden fields) and any files chosen with it. Nothing else is saved until it's posted. The form
// is views/admin/compose.tsx.
import { Array as Arr } from 'effect'

import {
  isPostFileName,
  isUploadableFileName,
  mimeType,
  type PostIssue,
  type PostRecord,
} from './post.ts'

export interface ComposeValues {
  readonly id: string
  // As typed.
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

// The composer's values for a published post, to edit it.
export function composeValues(post: PostRecord): ComposeValues {
  return {
    id: post.id,
    caption: post.caption ?? '',
    photos: post.type === 'photos' ? post.photos.map((photo) => photo.file) : [],
    video: post.type === 'video' ? post.video.file : undefined,
    poster: post.type === 'video' ? post.video.poster : undefined,
  }
}

// Reads a submitted composer for post `id`, whose stored files are `stored`. `remove` names a
// file to take out (the button on its tile sends it); the video's poster goes with it. Images
// chosen are photos, or with a video, its poster. A chosen file never takes the name of one the
// post has, so nothing published changes until the post is saved: it gets a number added
// (photo.jpg, photo-2.jpg), as phones often name every photo alike. A post has photos or a
// video, not both.
export function readComposeForm(
  formData: FormData,
  id: string,
  stored: readonly string[],
): ComposeForm {
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
  let taken = new Set([...stored, ...photos, video, poster])
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

  return { values: { id, caption: text('caption'), photos, video, poster }, uploads, issues }
}

// The name an uploaded file is saved under: its own, without any folders (some browsers send
// them), and with dashes for spaces, so its URL reads cleanly.
function uploadName(name: string): string {
  return (name.split(/[\\/]/).pop() ?? '').trim().replace(/\s+/g, '-')
}

// `name`, or with -2, -3, … before its extension, whichever isn't taken.
function unusedName(name: string, taken: ReadonlySet<string | undefined>): string {
  let dot = name.lastIndexOf('.')
  let [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  let candidate = name
  for (let n = 2; taken.has(candidate); n++) candidate = `${stem}-${n}${extension}`
  return candidate
}

// The post the composer makes: a new one dated `date`, or an edit of `published`, which keeps
// what the composer doesn't show: its date, city, photos' alt text, and its video's size, unless
// the video is replaced. It isn't checked: saving checks it, and the preview shows it as it is.
export function composePost(
  values: ComposeValues,
  date: string,
  published?: PostRecord,
): PostRecord {
  let { id, photos, video, poster } = values
  let caption = values.caption.trim() || undefined
  let city = published?.city
  let base = {
    id,
    date: published?.date ?? date,
    ...(city !== undefined && { city }),
    ...(caption && { caption }),
  }
  if (video) {
    let { width, height } =
      published?.type === 'video' && published.video.file === video ? published.video : {}
    return {
      ...base,
      type: 'video',
      video: {
        file: video,
        ...(poster && { poster }),
        ...(width && { width }),
        ...(height && { height }),
      },
    }
  }
  if (Arr.isReadonlyArrayNonEmpty(photos)) {
    let alts = new Map(
      published?.type === 'photos' ? published.photos.map((photo) => [photo.file, photo.alt]) : [],
    )
    return {
      ...base,
      type: 'photos',
      photos: Arr.map(photos, (file) => ({ file, alt: alts.get(file) ?? file })),
    }
  }
  return { ...base, type: 'text', caption: caption ?? '' }
}
