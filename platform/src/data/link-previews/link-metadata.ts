// What a link's page says about itself, for its preview card: its Open Graph / Twitter card
// tags, else its <title> and meta description.
import { Schema } from 'effect'

import { clamp } from '../posts/format.ts'

// As it's cached (see link-previews.ts).
export const LinkMetadata = Schema.Struct({
  title: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  image: Schema.optionalKey(Schema.String),
  // Sites asking for a small card (twitter:card "summary", e.g. profile pages with a square
  // avatar) get a thumbnail beside the text instead of a wide image above it.
  smallImage: Schema.optionalKey(Schema.Boolean),
})
export type LinkMetadata = typeof LinkMetadata.Type

export function parseLinkMetadata(html: string, pageUrl: string): LinkMetadata {
  let headEnd = html.search(/<\/head>/i)
  let head = headEnd === -1 ? html : html.slice(0, headEnd)
  let meta = new Map<string, string>()
  for (let [tag] of head.matchAll(/<meta\s[^>]*>/gi)) {
    let attributes = new Map<string, string>()
    for (let [, name = '', , doubleQuoted, singleQuoted, bare = ''] of tag.matchAll(
      /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g,
    )) {
      attributes.set(name.toLowerCase(), doubleQuoted ?? singleQuoted ?? bare)
    }
    let key = (attributes.get('property') ?? attributes.get('name'))?.toLowerCase()
    let content = attributes.get('content')
    if (key && content && !meta.has(key)) meta.set(key, decodeEntities(content).trim())
  }

  let first = (...keys: string[]) => keys.map((key) => meta.get(key)).find(Boolean)
  let title =
    first('og:title', 'twitter:title') ??
    decodeEntities(head.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '').trim()
  let description = first('og:description', 'twitter:description', 'description')
  let image = first(
    'og:image',
    'og:image:url',
    'og:image:secure_url',
    'twitter:image',
    'twitter:image:src',
  )

  let imageUrl = image && toHttpsUrl(image, pageUrl)
  return {
    ...(title && { title: clamp(title, 200) }),
    ...(description && { description: clamp(description, 300) }),
    ...(imageUrl && { image: imageUrl }),
    ...(meta.get('twitter:card') === 'summary' && { smallImage: true }),
  }
}

// An absolute https URL, upgrading http so the image isn't blocked as mixed content on this site.
function toHttpsUrl(url: string, base: string): string | undefined {
  let resolved = URL.parse(url, base)
  if (resolved?.protocol === 'http:') resolved.protocol = 'https:'
  return resolved?.protocol === 'https:' ? resolved.href : undefined
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (entity, code: string) => {
    if (!code.startsWith('#')) return NAMED_ENTITIES[code.toLowerCase()] ?? entity
    let point = /^#x/i.test(code) ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity
  })
}
