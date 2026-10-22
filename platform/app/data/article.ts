import * as path from 'node:path'
import { renderDocument } from '@tanstack/markdown/html'
import { parseMarkdown } from '@tanstack/markdown/parser'
import type { BlockNode } from '@tanstack/markdown'

import { FULL_WIDTH_IMAGE_SIZES } from '../lib/constants.ts'
import { getImageSources, type ImageInfo } from './images.ts'
import { getPostFileKey, getPostImages, hasPostFile } from './media.ts'
import { getPostFileUrl, type ArticlePost } from './posts.ts'

// The HTML of an article's body. Rendered once and kept until the body, its videos' posters, or
// its images change. The posters are looked up in media storage on every call, by name rather than
// by listing the post's files, which the fs backend can only do by reading every file's metadata,
// and the images' sizes and versions in the database.
export async function getArticleHtml(post: ArticlePost): Promise<string> {
  let { body } = post.article
  let cached = cache.get(post.id)
  if (cached?.body !== body) {
    let candidates = findPosterCandidates(post.id, body)
    let imageNames = findImageNames(post.id, body)
    cached = { body, candidates, imageNames, key: '', html: undefined }
    cache.set(post.id, cached)
  }
  let [found, images] = await Promise.all([
    Promise.all(cached.candidates.map((name) => hasPostFile(post.id, name))),
    getPostImages(cached.imageNames.map((name) => [post.id, name])),
  ])
  let posters = cached.candidates.filter((_, i) => found[i])
  let key = JSON.stringify([posters, [...images]])
  if (cached.html === undefined || cached.key !== key) {
    cached.key = key
    cached.html = renderArticle(post.id, body, posters, images)
  }
  return cached.html
}

let cache = new Map<
  string,
  {
    body: string
    candidates: string[]
    imageNames: string[]
    key: string
    html: string | undefined
  }
>()

// The names of the post's files shown as images on their own line in an article.
function findImageNames(id: string, markdown: string): string[] {
  let names = getBlockImages(parseArticle(id, markdown)).flatMap((image) => {
    let name = postFileName(id, image.src)
    return name && !VIDEO_EXTENSION.test(name) ? [name] : []
  })
  return [...new Set(names)]
}

// The name of the post's file a URL points to, if it does.
function postFileName(id: string, src: string) {
  let prefix = getPostFileUrl(id, '')
  return src.startsWith(prefix) ? decodeURIComponent(src.slice(prefix.length)) : undefined
}

// The names a poster could have for each video on its own line in an article: the video's name
// with an image extension, in lower or upper case (clip.mp4 → clip.jpg, clip.JPG, clip.png…).
function findPosterCandidates(id: string, markdown: string): string[] {
  let names = getBlockImages(parseArticle(id, markdown)).flatMap((image) =>
    VIDEO_EXTENSION.test(image.src) ? [videoName(image.src)] : [],
  )
  return [...new Set(names)].flatMap((name) =>
    IMAGE_EXTENSIONS.flatMap((extension) => [
      `${name}.${extension}`,
      `${name}.${extension.toUpperCase()}`,
    ]),
  )
}

// Renders an article's Markdown. Relative links and images point to the post's files, and an
// image on its own line becomes a lazy-loaded <img>, or a <video> if it's a video file. An image
// of the post's that's in `images` (by key in media storage, see getPostImages) gets its size and
// resized copies. A video's poster is the one of `files` (the post's files) with the same name as
// the video but an image extension (clip.mp4 → clip.jpg), if there is one. Raw HTML in the
// Markdown is escaped.
export function renderArticle(
  id: string,
  markdown: string,
  files: string[] = [],
  images = new Map<string, ImageInfo>(),
): string {
  let document = parseArticle(id, markdown)

  document.children = document.children.map((node): BlockNode => {
    let image = node.type === 'paragraph' && node.children.length === 1 ? node.children[0] : null
    if (image?.type !== 'image') return node

    let alt = escapeAttribute(image.alt)
    let src = escapeAttribute(image.src)
    if (!VIDEO_EXTENSION.test(image.src)) {
      let name = postFileName(id, image.src)
      let info = name === undefined ? undefined : images.get(getPostFileKey(id, name))
      return { type: 'html', value: renderImage(image.src, alt, name, info) }
    }

    let name = videoName(image.src)
    let poster = files.find(
      (file) => IMAGE_EXTENSION.test(file) && file.replace(IMAGE_EXTENSION, '') === name,
    )
    let posterAttribute = poster ? ` poster="${escapeAttribute(getPostFileUrl(id, poster))}"` : ''
    return {
      type: 'html',
      value:
        `<video src="${src}"${posterAttribute} aria-label="${alt}"` +
        ' controls playsinline preload="metadata"></video>',
    }
  })

  // allowHtml only lets through the <img> and <video> nodes added above; the parser already turned
  // any HTML written in the Markdown into escaped text.
  let html = renderDocument(document, { allowHtml: true })

  // Links to the post's files (a PDF, a full-size photo) are opened by the browser rather
  // than Remix's client-side navigation, which would try to render the file as a page.
  let fileLink = `<a href="${escapeAttribute(getPostFileUrl(id, ''))}`
  return html.replaceAll(
    fileLink,
    `<a data-rmx-document href="${fileLink.slice('<a href="'.length)}`,
  )
}

function renderImage(url: string, alt: string, name?: string, info?: ImageInfo) {
  let attributes = `alt="${alt}" loading="lazy" decoding="async"`
  if (name === undefined || info === undefined) {
    return `<img src="${escapeAttribute(url)}" ${attributes}>`
  }
  let { width, height, version } = info
  let srcset = getImageSources(name, info)
    .map((source) => `${url}?w=${source.param}&v=${version} ${source.width}w`)
    .join(', ')
  let responsive = srcset
    ? ` srcset="${escapeAttribute(srcset)}" sizes="${FULL_WIDTH_IMAGE_SIZES}"`
    : ''
  return (
    `<img src="${escapeAttribute(`${url}?v=${version}`)}"${responsive}` +
    ` width="${width}" height="${height}" ${attributes}>`
  )
}

// The images on their own line in a parsed article.
function getBlockImages(document: ReturnType<typeof parseArticle>) {
  return document.children.flatMap((node) => {
    let image = node.type === 'paragraph' && node.children.length === 1 ? node.children[0] : null
    return image?.type === 'image' ? [image] : []
  })
}

// Relative URLs point to the post's files.
function parseArticle(id: string, markdown: string) {
  return parseMarkdown(markdown, {
    urlTransform(url, _kind, defaultUrl) {
      return isRelative(url) ? getPostFileUrl(id, url) : defaultUrl
    },
  })
}

const VIDEO_EXTENSION = /\.(mp4|webm|mov|m4v)$/i
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif']
const IMAGE_EXTENSION = new RegExp(`\\.(${IMAGE_EXTENSIONS.join('|')})$`, 'i')

// A video's file name without its extension, which its poster's name starts with.
function videoName(src: string) {
  return decodeURIComponent(path.posix.basename(src)).replace(VIDEO_EXTENSION, '')
}

function isRelative(url: string) {
  return !/^([a-z][a-z0-9+.-]*:|\/|#|\?)/i.test(url)
}

function escapeAttribute(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
