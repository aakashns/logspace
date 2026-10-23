// URLs in plain text, like a caption's.

// http(s) URLs, minus trailing punctuation like the period ending a sentence.
const URL_PATTERN = /https?:\/\/[^\s<>"]+[^\s<>".,:;!?'")\]]/g

// The URLs in text, in order. Something that looks like one but doesn't parse, like
// https://[bad-host], stays plain text, since nothing could load it.
function findLinks(text: string) {
  return [...text.matchAll(URL_PATTERN)].filter((match) => URL.canParse(match[0]))
}

// Splits text into plain strings and URLs, in order.
export function splitLinks(text: string): Array<string | { url: string }> {
  let parts: Array<string | { url: string }> = []
  let last = 0
  for (let match of findLinks(text)) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    parts.push({ url: match[0] })
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

export function getFirstLink(text: string): string | undefined {
  return findLinks(text)[0]?.[0]
}

// How a link reads in a caption: no scheme or "www.", and long URLs shortened like on X.
export function formatLinkText(url: string): string {
  let text = url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
  return text.length > 40 ? `${text.slice(0, 39)}…` : text
}

export function getDomain(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '')
}
