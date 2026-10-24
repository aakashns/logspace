// What the composer at /admin/posts/new submits: a caption, and photos, a video (with an optional
// poster), or an article from a Markdown file (with an optional cover). The post's type follows
// from its media, its date is when it's posted, and a photo's alt text is its file name. Media is
// uploaded as it's chosen, so each submission lists what was added before (in hidden fields) and
// any files chosen with it. The form is views/admin/compose.tsx.
import { Array as Arr } from 'effect'

import {
  isPostFileName,
  isUploadableFileName,
  mimeType,
  type PostIssue,
  type PostRecord,
} from './post.ts'
import { findArticleFiles } from './markdown.ts'
import { uploadName } from './post-form.ts'

export interface ComposeValues {
  readonly id: string
  // Markdown, as typed.
  readonly caption: string
  readonly city: string
  // The UTC offset of where it's written, like "+05:30": the browser's, else the newest post's.
  readonly offset: string
  readonly photos: readonly string[]
  readonly video?: string | undefined
  readonly poster?: string | undefined
  readonly article?: ArticleValues | undefined
  readonly cover?: string | undefined
}

export interface ArticleValues {
  readonly title: string
  readonly summary: string
  // Markdown, as the file had it, less a title heading at the top.
  readonly body: string
  // The name of the file it came from.
  readonly source: string
}

// A submitted composer: what it holds, the files chosen with it (already named in `values`), the
// chosen files that couldn't be added, a Markdown file chosen for the article, whose text
// `withArticleText` adds, and the files the post used before this submission changed it.
export interface ComposeForm {
  values: ComposeValues
  uploads: { name: string; file: File }[]
  issues: PostIssue[]
  articleFile?: File | undefined
  used: string[]
}

type MediaKind = 'photos' | 'video' | 'article'

// Bodies are stored in the database, and anything near this is likely not an article.
const MAX_ARTICLE_SIZE = 1024 * 1024

// Reads a submitted composer. `remove` names a file to take out (the button on its tile sends
// it), and `remove_article` the article; the video's poster and the article's cover go with them.
// A chosen photo, poster, or cover whose name the post already uses gets a number added
// (photo.jpg, photo-2.jpg), since phones often name every photo alike, but the article's own
// images and videos keep their names, which its Markdown uses. A post has one kind of media, so
// files of another kind than it has are left out.
export function readComposeForm(formData: FormData): ComposeForm {
  let text = (name: string) => {
    let value = formData.get(name)
    // Browsers send textarea line breaks as \r\n.
    return typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : ''
  }
  let remove = text('remove')
  let submitted = (name: string) =>
    formData
      .getAll(name)
      .flatMap((value) =>
        typeof value === 'string' && isPostFileName(value.trim()) ? [value.trim()] : [],
      )
  let fileNames = (name: string) => submitted(name).filter((file) => file !== remove)
  // A file input left empty sends an empty file.
  let chosen = (name: string) =>
    formData.getAll(name).filter((value) => value instanceof File && value.size > 0)

  let photos = fileNames('photo')
  let [video] = fileNames('video')
  let [poster] = video ? fileNames('poster') : []
  let body = text('article_body')
  let id = text('id').trim()
  let used = [
    ...['photo', 'video', 'poster', 'cover'].flatMap(submitted),
    ...(body.trim() === '' ? [] : findArticleFiles(id, body)),
  ]
  let article: ArticleValues | undefined =
    body.trim() !== '' && formData.get('remove_article') === null
      ? {
          title: text('article_title').trim(),
          summary: text('article_summary').trim(),
          body,
          source: text('article_source').trim(),
        }
      : undefined
  let [cover] = article ? fileNames('cover') : []

  let issues: PostIssue[] = []
  let kind: MediaKind | undefined = video
    ? 'video'
    : article
      ? 'article'
      : photos.length > 0
        ? 'photos'
        : undefined
  // Whether files of `next` can be added, and if so, that the post now has that kind.
  let allows = (next: MediaKind) => {
    if (kind && kind !== next) {
      issues.push({ message: ONE_KIND })
      return false
    }
    kind = next
    return true
  }
  let photoFiles = chosen('photo_uploads')
  if (photoFiles.length > 0 && !allows('photos')) photoFiles = []
  let [videoFile] = chosen('video_upload')
  if (videoFile && !allows('video')) videoFile = undefined
  let [articleFile] = chosen('article_upload')
  if (articleFile && !allows('article')) articleFile = undefined
  if (articleFile instanceof File) {
    if (!/\.(md|txt)$/i.test(articleFile.name)) {
      issues.push({
        message: `“${articleFile.name}” can’t be added as an article: only Markdown (.md) or text (.txt) files can.`,
      })
      articleFile = undefined
    } else if (articleFile.size > MAX_ARTICLE_SIZE) {
      issues.push({ message: `“${articleFile.name}” is too big to be an article.` })
      articleFile = undefined
    }
  }

  let uploads: ComposeForm['uploads'] = []
  let taken = new Set([...photos, video, poster, cover])
  let upload = (value: FormDataEntryValue, type: 'image' | 'video' | 'media', rename = true) => {
    if (!(value instanceof File)) return undefined
    let name = uploadName(value.name)
    let fileType = mimeType(name) ?? ''
    let fits = type === 'media' || fileType.startsWith(`${type}/`)
    if (!isUploadableFileName(name) || !fits) {
      let expected = {
        image: 'photos, like .jpg or .png files',
        video: 'videos, like .mp4 files',
        media: 'photos and videos',
      }[type]
      issues.push({ message: `“${value.name}” can’t be added here: only ${expected} can.` })
      return undefined
    }
    if (rename) name = unusedName(name, taken)
    taken.add(name)
    uploads.push({ name, file: value })
    return name
  }
  for (let file of photoFiles) {
    let name = upload(file, 'image')
    if (name) photos.push(name)
  }
  if (videoFile) video = upload(videoFile, 'video') ?? video
  let [posterFile] = chosen('poster_upload')
  if (posterFile && video) poster = upload(posterFile, 'image') ?? poster
  let hasArticle = article !== undefined || articleFile !== undefined
  let [coverFile] = chosen('cover_upload')
  if (coverFile && hasArticle) cover = upload(coverFile, 'image') ?? cover
  if (hasArticle) for (let file of chosen('article_files')) upload(file, 'media', false)

  let offset = text('offset').trim()
  let values: ComposeValues = {
    id,
    caption: text('caption'),
    city: text('city').trim(),
    offset: /^[+-](0\d|1[0-4]):[0-5]\d$/.test(offset) ? offset : '+00:00',
    photos,
    video,
    poster,
    article,
    cover,
  }
  return {
    values,
    uploads,
    issues,
    articleFile: articleFile instanceof File ? articleFile : undefined,
    used,
  }
}

// The files the post used before the submission and doesn't now: a photo, poster, or cover that
// was removed, a video or article that was removed or replaced, and the files a removed
// article's body used. They can be deleted, as nothing will show them. A body's relative links
// that can't be files (like `notes/today`) aren't.
export function filesNoLongerUsed(form: ComposeForm): string[] {
  let { photos, video, poster, cover, article, id } = form.values
  let using = new Set([
    ...photos,
    video,
    poster,
    cover,
    ...(article ? findArticleFiles(id, article.body) : []),
  ])
  return [...new Set(form.used)].filter((file) => isPostFileName(file) && !using.has(file))
}

const ONE_KIND =
  'A post can have photos, a video, or an article, but only one of them. Remove it to add another.'

// `name`, or with -2, -3, … before its extension, whichever isn't taken.
function unusedName(name: string, taken: ReadonlySet<string | undefined>): string {
  let dot = name.lastIndexOf('.')
  let [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  let candidate = name
  for (let n = 2; taken.has(candidate); n++) candidate = `${stem}-${n}${extension}`
  return candidate
}

// The composer with the article from a Markdown file named `source`. A heading at the top
// (`# Title`) is its title, since the page shows the title above the body; without one, the title
// typed so far stays. The summary stays too.
export function withArticleText(form: ComposeForm, source: string, text: string): ComposeForm {
  let markdown = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  if (markdown.trim() === '') {
    return { ...form, issues: [...form.issues, { message: `“${source}” is empty.` }] }
  }
  let heading = /^\s*#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*(?:\n|$)/.exec(markdown)
  let previous = form.values.article
  let article: ArticleValues = {
    title: heading?.[1]?.trim() ?? previous?.title ?? '',
    summary: previous?.summary ?? '',
    body: heading ? markdown.slice(heading[0].length).replace(/^\s*\n/, '') : markdown,
    source,
  }
  return { ...form, values: { ...form.values, article } }
}

// The post the composer makes, dated `date`. It isn't checked: publishing checks it, and the
// preview shows it as it is.
export function composePost(values: ComposeValues, date: string): PostRecord {
  let { id, city, photos, video, poster, article, cover } = values
  // Markdown is kept as typed, since leading spaces can matter; only a blank caption is none.
  let caption = values.caption.trim() === '' ? undefined : values.caption
  let base = {
    id,
    date,
    ...(city !== '' && { city }),
    ...(caption !== undefined && { caption }),
  }
  if (video) {
    return { ...base, type: 'video', video: { file: video, ...(poster && { poster }) } }
  }
  if (article) {
    let { title, summary, body } = article
    return {
      ...base,
      type: 'article',
      article: { title, summary, body, ...(cover && { cover: { file: cover, alt: cover } }) },
    }
  }
  if (Arr.isReadonlyArrayNonEmpty(photos)) {
    return { ...base, type: 'photos', photos: Arr.map(photos, (file) => ({ file, alt: file })) }
  }
  return { ...base, type: 'text', caption: caption ?? '' }
}
