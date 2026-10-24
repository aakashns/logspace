// Captions and articles are Markdown, rendered by Bun.markdown with a callback for each element.
// Raw HTML in either is shown as text: inline HTML reaches `text`, which escapes it like any other
// text, and HTML blocks are turned off, so the only HTML let through is what the callbacks write.
import { routes } from '../routes.ts'
import { FULL_WIDTH_IMAGE_SIZES } from './constants.ts'
import { getSrcset, type ImageInfo } from './images.ts'
import { formatLinkText, splitLinks } from './links.ts'

type Callbacks = Bun.markdown.RenderCallbacks

// Bun's own autolinks aren't used: a URL just before "**" takes a "*" and loses the rest of the
// document (Bun 1.4.4). Captions find their URLs with splitLinks instead.
const OPTIONS: Bun.markdown.Options = { noHtmlBlocks: true }

// Every element as HTML, each block on its own line.
const HTML = {
  heading: (children, { level, id }) =>
    `<h${level}${id ? ` id="${escapeHtml(id)}"` : ''}>${children}</h${level}>\n`,
  paragraph: (children) => `<p>${children}</p>\n`,
  blockquote: (children) => `<blockquote>\n${children}</blockquote>\n`,
  code: (children, meta) =>
    `<pre><code${meta?.language ? ` class="language-${escapeHtml(meta.language)}"` : ''}>` +
    `${children}</code></pre>\n`,
  list: (children, { ordered, start = 1 }) =>
    ordered
      ? `<ol${start === 1 ? '' : ` start="${start}"`}>\n${children}</ol>\n`
      : `<ul>\n${children}</ul>\n`,
  listItem: (children, { checked }) => {
    let box =
      checked === undefined ? '' : `<input type="checkbox" disabled${checked ? ' checked' : ''}> `
    return `<li>${box}${children}</li>\n`
  },
  hr: () => '<hr>\n',
  table: (children) => `<table>\n${children}</table>\n`,
  thead: (children) => `<thead>\n${children}</thead>\n`,
  tbody: (children) => `<tbody>\n${children}</tbody>\n`,
  tr: (children) => `<tr>${children}</tr>\n`,
  th: (children, meta) => `<th${alignment(meta)}>${children}</th>`,
  td: (children, meta) => `<td${alignment(meta)}>${children}</td>`,
  strong: (children) => `<strong>${children}</strong>`,
  emphasis: (children) => `<em>${children}</em>`,
  strikethrough: (children) => `<del>${children}</del>`,
  codespan: (children) => `<code>${children}</code>`,
  link: (children, { href, title }) => {
    let url = safeUrl(href)
    return url === undefined
      ? children
      : `<a href="${escapeHtml(url)}"${titleAttribute(title)}>${children}</a>`
  },
  // An image's children are its alt text, rendered.
  image: (children, { src, title }) => {
    let url = safeUrl(src) ?? ''
    return `<img src="${escapeHtml(url)}" alt="${stripTags(children)}"${titleAttribute(title)}>`
  },
  text: escapeHtml,
} satisfies Callbacks

// Callbacks build the HTML from the inside out, so an element can't see what's around it.
// Something whose HTML depends on that is written as a placeholder, swapped once it's known.
// Text can't be mistaken for one, since the parser replaces the NULs around them.
function makePlaceholders<T>() {
  let values: T[] = []
  let at = (index: string) => values[Number(index)]
  return {
    add: (value: T) => `\0${values.push(value) - 1}\0`,
    // The value, if `html` is just its placeholder.
    get: (html: string) => {
      let match = /^\0(\d+)\0$/.exec(html)
      return match?.[1] === undefined ? undefined : at(match[1])
    },
    replace: (html: string, write: (value: T) => string) =>
      html.replace(/\0(\d+)\0/g, (_, index: string) => {
        let value = at(index)
        return value === undefined ? '' : write(value)
      }),
  }
}

// Captions are written like a tweet: bare URLs become shortened links and every line break is
// kept, not just the ones Markdown would keep. Links open in a new tab.
export function renderCaption(caption: string): string {
  // A bare URL becomes a link unless it's in a link or code already, where it stays as written.
  let urls = makePlaceholders<string>()
  let asWritten = (html: string) => urls.replace(html, escapeHtml)
  let breaks = (html: string) => html.replaceAll('\n', '<br>')
  let newTab = (html: string) => html.replaceAll('<a ', '<a target="_blank" rel="noopener" ')
  let html = Bun.markdown.render(
    caption,
    {
      ...HTML,
      heading: (children, meta) => HTML.heading(breaks(children), meta),
      paragraph: (children) => HTML.paragraph(breaks(children)),
      code: (children, meta) => HTML.code(asWritten(children), meta),
      codespan: (children) => HTML.codespan(asWritten(children)),
      image: (children, meta) => HTML.image(asWritten(children), meta),
      link: (children, meta) => {
        let text = asWritten(children)
        // Like <https://example.com>, which reads shortened too.
        if (text === escapeHtml(meta.href)) text = escapeHtml(formatLinkText(meta.href))
        return newTab(HTML.link(text, meta))
      },
      text: (text) =>
        splitLinks(text)
          .map((part) => (typeof part === 'string' ? escapeHtml(part) : urls.add(part.url)))
          .join(''),
    },
    OPTIONS,
  )
  return urls
    .replace(html, (url) => newTab(HTML.link(escapeHtml(formatLinkText(url)), { href: url })))
    .trim()
}

// A caption's text without its Markdown, one block or list item per line, for page titles and
// descriptions.
export function captionText(caption: string): string {
  let line = (text: string) => `${text}\n`
  return Bun.markdown
    .render(caption, { paragraph: line, heading: line, listItem: line, tr: line }, OPTIONS)
    .replace(/\n+/g, '\n')
    .trim()
}

// What renderArticle needs to know about the post's files, besides the Markdown.
export interface ArticleFiles {
  // The post's files that could be video posters (see findPosterCandidates) and exist.
  posters: readonly string[]
  // The size and version of each of the post's images the body shows, by file name.
  images: ReadonlyMap<string, ImageInfo>
}

// An image in an article: its URL, and its alt text as HTML.
interface ArticleImage {
  src: string
  alt: string
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
  let blockImage = ({ src, alt }: ArticleImage) => {
    if (!VIDEO_EXTENSION.test(src)) {
      let name = postFileName(id, src)
      let info = name === undefined ? undefined : files.images.get(name)
      return renderImage(src, alt, name, info)
    }
    let name = videoName(src)
    let poster = files.posters.find(
      (file) => IMAGE_EXTENSION.test(file) && file.replace(IMAGE_EXTENSION, '') === name,
    )
    let posterAttribute = poster ? ` poster="${escapeHtml(routes.postFile(id, poster))}"` : ''
    return (
      `<video src="${escapeHtml(src)}"${posterAttribute} aria-label="${alt}"` +
      ' controls playsinline preload="metadata"></video>'
    )
  }
  return renderArticleWith(id, markdown, blockImage)
}

// The names of the post's files shown as images (not videos) on their own line in an article.
export function findImageNames(id: string, markdown: string): string[] {
  let names = getBlockImages(id, markdown).flatMap((image) => {
    let name = postFileName(id, image.src)
    return name && !VIDEO_EXTENSION.test(name) ? [name] : []
  })
  return [...new Set(names)]
}

// The names a poster could have for each video on its own line in an article: the video's name
// with an image extension, in lower or upper case (clip.mp4 → clip.jpg, clip.JPG, clip.png…).
export function findPosterCandidates(id: string, markdown: string): string[] {
  let names = getBlockImages(id, markdown).flatMap((image) =>
    VIDEO_EXTENSION.test(image.src) ? [videoName(image.src)] : [],
  )
  return [...new Set(names)].flatMap((name) =>
    IMAGE_EXTENSIONS.flatMap((extension) => [
      `${name}.${extension}`,
      `${name}.${extension.toUpperCase()}`,
    ]),
  )
}

// An article as HTML, with `blockImage` writing each (safe) image that's alone in a paragraph,
// which is shown full width, and relative URLs pointing to the post's files. An image is a
// placeholder until its paragraph shows whether it's alone.
function renderArticleWith(
  id: string,
  markdown: string,
  blockImage: (image: ArticleImage) => string,
): string {
  let images = makePlaceholders<ArticleImage>()
  let url = (href: string) => (isRelative(href) ? routes.postFile(id, safeDecode(href)) : href)
  let html = Bun.markdown.render(
    markdown,
    {
      ...HTML,
      link: (children, meta) => HTML.link(children, { ...meta, href: url(meta.href) }),
      image: (children, { src }) => images.add({ src: url(src), alt: stripTags(children) }),
      paragraph: (children) => {
        let image = images.get(children)
        return image && safeUrl(image.src) !== undefined
          ? `${blockImage(image)}\n`
          : HTML.paragraph(children)
      },
    },
    // Headings get ids, for links to a section.
    { ...OPTIONS, headings: { ids: true } },
  )
  return images.replace(html, ({ src, alt }) => HTML.image(alt, { src })).trim()
}

function getBlockImages(id: string, markdown: string): ArticleImage[] {
  let found: ArticleImage[] = []
  renderArticleWith(id, markdown, (image) => {
    found.push(image)
    return ''
  })
  return found
}

function renderImage(url: string, alt: string, name?: string, info?: ImageInfo): string {
  let attributes = `alt="${alt}" loading="lazy" decoding="async"`
  if (name === undefined || info === undefined) {
    return `<img src="${escapeHtml(url)}" ${attributes}>`
  }
  let { width, height, version } = info
  let srcset = getSrcset(url, name, info)
  let responsive = srcset ? ` srcset="${escapeHtml(srcset)}" sizes="${FULL_WIDTH_IMAGE_SIZES}"` : ''
  return (
    `<img src="${escapeHtml(`${url}?v=${version}`)}"${responsive}` +
    ` width="${width}" height="${height}" ${attributes}>`
  )
}

// The name of the post's file a URL points to, if it does.
function postFileName(id: string, src: string): string | undefined {
  let prefix = routes.postFile(id, '')
  return src.startsWith(prefix) ? safeDecode(src.slice(prefix.length)) : undefined
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

// Links and images go only to the web, email, phone numbers, and this site; a link to anything
// else (like javascript:) goes nowhere. Browsers ignore spaces and control characters in a
// scheme (java\tscript:), so the check does too.
function safeUrl(url: string): string | undefined {
  let scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url.replace(/[^!-~]/g, ''))?.[1]?.toLowerCase()
  return scheme === undefined || ['http', 'https', 'mailto', 'tel'].includes(scheme)
    ? url
    : undefined
}

function alignment(meta: Bun.markdown.CellMeta | undefined): string {
  return meta?.align ? ` style="text-align: ${meta.align}"` : ''
}

function titleAttribute(title: string | undefined): string {
  return title ? ` title="${escapeHtml(title)}"` : ''
}

// Text from HTML this module wrote, still escaped, for an attribute.
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '')
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
