// Captions are plain text, written like a tweet: URLs become shortened links, line breaks are
// kept, a blank line starts a new paragraph, and **bold** and *italic* are the only formatting.
import { escapeAttribute, escapeHtml } from '#jsx/jsx-runtime'

// http(s) URLs, minus trailing punctuation like the period ending a sentence or a bold's "**".
const URL_PATTERN = /https?:\/\/[^\s<>"]+[^\s<>".,:;!?'")\]*]/g

// Within a line. A "*" next to another isn't italic, so "**" is always bold, and italic goes
// first, so bold can't end inside it. Neither runs past its next marker, so an unclosed one costs
// no more than a scan to that marker.
const ITALIC = /(?<!\*)\*(?=[^\s*])([^*\n]*?[^\s*])\*(?!\*)/g
const BOLD = /\*\*(?=[^\s*])((?:[^*\n]|\*(?!\*))*?[^\s*])\*\*/g

// The URLs in text, in order. Something that looks like one but doesn't parse, like
// https://[bad-host], stays plain text, since nothing could load it.
function findLinks(text: string) {
  return [...text.matchAll(URL_PATTERN)].filter((match) => URL.canParse(match[0]))
}

export function getFirstLink(text: string): string | undefined {
  return findLinks(text)[0]?.[0]
}

export function renderCaption(caption: string): string {
  return caption
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => `<p>${renderParagraph(paragraph.trim())}</p>`)
    .join('\n')
}

// URLs are set aside as <0>, <1>, … while the rest is formatted, so a "*" in one stays as it is.
// Escaped text has no "<", so it can't be mistaken for them.
function renderParagraph(text: string): string {
  let urls: string[] = []
  let html = ''
  let last = 0
  for (let match of findLinks(text)) {
    html += `${escapeHtml(text.slice(last, match.index))}<${urls.push(match[0]) - 1}>`
    last = match.index + match[0].length
  }
  return (html + escapeHtml(text.slice(last)))
    .replace(ITALIC, '<em>$1</em>')
    .replace(BOLD, '<strong>$1</strong>')
    .replace(/<(\d+)>/g, (_, index: string) => renderLink(urls[Number(index)] ?? ''))
    .replaceAll('\n', '<br>')
}

// Opens in a new tab, and reads without its scheme or "www.", shortened when long, like on X.
function renderLink(url: string): string {
  let text = url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
  if (text.length > 40) text = `${text.slice(0, 39)}…`
  return `<a target="_blank" rel="noopener" href="${escapeAttribute(url)}">${escapeHtml(text)}</a>`
}

// A caption without its formatting, one paragraph per line, for page titles and descriptions.
export function captionText(caption: string): string {
  return caption
    .replace(ITALIC, '$1')
    .replace(BOLD, '$1')
    .replace(/\n\s*\n/g, '\n')
    .trim()
}
