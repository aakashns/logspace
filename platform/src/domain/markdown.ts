// Captions and articles are Markdown. Raw HTML in either is shown as text: the parser turns it
// into escaped text, and the only HTML let through is what renderArticle adds itself.
import { renderDocument } from '@tanstack/markdown/html'
import { parseMarkdown } from '@tanstack/markdown/parser'
import type { BlockNode, InlineNode } from '@tanstack/markdown'

import { routes } from '../routes.ts'
import { FULL_WIDTH_IMAGE_SIZES } from './constants.ts'
import { getSrcset, type ImageInfo } from './images.ts'
import { formatLinkText, splitLinks } from './links.ts'

// Captions are written like a tweet: bare URLs become shortened links and every line break is
// kept, not just the ones Markdown would keep. Links open in a new tab.
export function renderCaption(caption: string): string {
  let document = parseMarkdown(caption)
  document.children = document.children.map(transformBlock)
  return renderDocument(document).replaceAll('<a href=', '<a target="_blank" rel="noopener" href=')
}

// A caption's text without its Markdown, one block or list item per line, for page titles and
// descriptions.
export function captionText(caption: string): string {
  return parseMarkdown(caption).children.map(blockText).join('\n')
}

function transformBlock(node: BlockNode): BlockNode {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      return { ...node, children: transformInlines(node.children) }
    case 'list':
      return {
        ...node,
        items: node.items.map((item) => ({ ...item, children: item.children.map(transformBlock) })),
      }
    case 'blockquote':
      return { ...node, children: node.children.map(transformBlock) }
    default:
      return node
  }
}

function transformInlines(nodes: InlineNode[]): InlineNode[] {
  return nodes.flatMap((node): InlineNode[] => {
    switch (node.type) {
      case 'text':
        return splitLinks(node.value).flatMap((part): InlineNode[] =>
          typeof part === 'string'
            ? splitBreaks(part)
            : [
                {
                  type: 'link',
                  href: part.url,
                  children: [{ type: 'text', value: formatLinkText(part.url) }],
                },
              ],
        )
      case 'strong':
      case 'emphasis':
      case 'strike':
        return [{ ...node, children: transformInlines(node.children) }]
      default:
        return [node]
    }
  })
}

function splitBreaks(text: string): InlineNode[] {
  return text
    .split('\n')
    .flatMap((line, index): InlineNode[] => [
      ...(index > 0 ? [{ type: 'break' } as const] : []),
      ...(line ? [{ type: 'text', value: line } as const] : []),
    ])
}

function blockText(node: BlockNode): string {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      return inlineText(node.children)
    case 'list':
      return node.items.map((item) => item.children.map(blockText).join('\n')).join('\n')
    case 'blockquote':
      return node.children.map(blockText).join('\n')
    case 'code':
      return node.value
    default:
      return ''
  }
}

function inlineText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'inlineCode':
          return node.value
        case 'break':
          return '\n'
        case 'image':
          return node.alt
        default:
          return 'children' in node ? inlineText(node.children) : ''
      }
    })
    .join('')
}

// What renderArticle needs to know about the post's files, besides the Markdown.
export interface ArticleFiles {
  // The post's files that could be video posters (see findPosterCandidates) and exist.
  posters: readonly string[]
  // The size and version of each of the post's images the body shows, by file name.
  images: ReadonlyMap<string, ImageInfo>
}

// Renders an article's Markdown. Relative links and images point to the post's files, and an
// image on its own line becomes a lazy-loaded <img>, or a <video> if it's a video file. An image
// that's in `files.images` gets its size and resized copies. A video's poster is the one of
// `files.posters` with the same name as the video but an image extension (clip.mp4 → clip.jpg).
export function renderArticle(
  id: string,
  markdown: string,
  files: ArticleFiles = { posters: [], images: new Map() },
): string {
  let document = parseArticle(id, markdown)

  document.children = document.children.map((node): BlockNode => {
    let image = blockImage(node)
    if (!image) return node

    let alt = escapeAttribute(image.alt)
    if (!VIDEO_EXTENSION.test(image.src)) {
      let name = postFileName(id, image.src)
      let info = name === undefined ? undefined : files.images.get(name)
      return { type: 'html', value: renderImage(image.src, alt, name, info) }
    }

    let name = videoName(image.src)
    let poster = files.posters.find(
      (file) => IMAGE_EXTENSION.test(file) && file.replace(IMAGE_EXTENSION, '') === name,
    )
    let posterAttribute = poster ? ` poster="${escapeAttribute(routes.postFile(id, poster))}"` : ''
    return {
      type: 'html',
      value:
        `<video src="${escapeAttribute(image.src)}"${posterAttribute} aria-label="${alt}"` +
        ' controls playsinline preload="metadata"></video>',
    }
  })

  // allowHtml only lets through the <img> and <video> nodes added above; the parser already turned
  // any HTML written in the Markdown into escaped text.
  return renderDocument(document, { allowHtml: true })
}

// The names of the post's files shown as images (not videos) on their own line in an article.
export function findImageNames(id: string, markdown: string): string[] {
  let names = getBlockImages(parseArticle(id, markdown)).flatMap((image) => {
    let name = postFileName(id, image.src)
    return name && !VIDEO_EXTENSION.test(name) ? [name] : []
  })
  return [...new Set(names)]
}

// The names a poster could have for each video on its own line in an article: the video's name
// with an image extension, in lower or upper case (clip.mp4 → clip.jpg, clip.JPG, clip.png…).
export function findPosterCandidates(id: string, markdown: string): string[] {
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

function renderImage(url: string, alt: string, name?: string, info?: ImageInfo): string {
  let attributes = `alt="${alt}" loading="lazy" decoding="async"`
  if (name === undefined || info === undefined) {
    return `<img src="${escapeAttribute(url)}" ${attributes}>`
  }
  let { width, height, version } = info
  let srcset = getSrcset(url, name, info)
  let responsive = srcset
    ? ` srcset="${escapeAttribute(srcset)}" sizes="${FULL_WIDTH_IMAGE_SIZES}"`
    : ''
  return (
    `<img src="${escapeAttribute(`${url}?v=${version}`)}"${responsive}` +
    ` width="${width}" height="${height}" ${attributes}>`
  )
}

// The name of the post's file a URL points to, if it does.
function postFileName(id: string, src: string): string | undefined {
  let prefix = routes.postFile(id, '')
  return src.startsWith(prefix) ? safeDecode(src.slice(prefix.length)) : undefined
}

// An image alone in a paragraph, which is shown full width.
function blockImage(node: BlockNode) {
  let image = node.type === 'paragraph' && node.children.length === 1 ? node.children[0] : null
  return image?.type === 'image' ? image : undefined
}

function getBlockImages(document: ReturnType<typeof parseArticle>) {
  return document.children.flatMap((node) => blockImage(node) ?? [])
}

// Relative URLs point to the post's files.
function parseArticle(id: string, markdown: string) {
  return parseMarkdown(markdown, {
    urlTransform(url, _kind, defaultUrl) {
      return isRelative(url) ? routes.postFile(id, url) : defaultUrl
    },
  })
}

const VIDEO_EXTENSION = /\.(mp4|webm|mov|m4v)$/i
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif']
const IMAGE_EXTENSION = new RegExp(`\\.(${IMAGE_EXTENSIONS.join('|')})$`, 'i')

// A video's file name without its extension, which its poster's name starts with.
function videoName(src: string): string {
  let base = src.slice(src.lastIndexOf('/') + 1)
  return safeDecode(base).replace(VIDEO_EXTENSION, '')
}

// A percent-encoded name, decoded, or as it is if it isn't valid percent-encoding (like "100%"),
// so one stray % in an article can't break its page or the RSS feed.
function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

function isRelative(url: string): boolean {
  return !/^([a-z][a-z0-9+.-]*:|\/|#|\?)/i.test(url)
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
