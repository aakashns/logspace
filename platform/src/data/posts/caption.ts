// Captions are plain text, written like a tweet: URLs become shortened links, line breaks are
// kept, and a blank line starts a new paragraph. There's no other formatting.
import { escapeAttribute, escapeHtml } from '#jsx/jsx-runtime'

// http(s) URLs, minus trailing punctuation like the period ending a sentence.
const URL_PATTERN = /https?:\/\/[^\s<>"]+[^\s<>".,:;!?'")\]]/g

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

function renderParagraph(text: string): string {
  let html = ''
  let last = 0
  for (let match of findLinks(text)) {
    html += escapeHtml(text.slice(last, match.index)) + renderLink(match[0])
    last = match.index + match[0].length
  }
  return (html + escapeHtml(text.slice(last))).replaceAll('\n', '<br>')
}

// Opens in a new tab, and reads without its scheme or "www.", shortened when long, like on X.
function renderLink(url: string): string {
  let text = url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
  if (text.length > 40) text = `${text.slice(0, 39)}…`
  return `<a target="_blank" rel="noopener" href="${escapeAttribute(url)}">${escapeHtml(text)}</a>`
}

// A caption with one paragraph per line, for page titles and descriptions.
export function captionText(caption: string): string {
  return caption.replace(/\n\s*\n/g, '\n').trim()
}
