import * as fsp from 'node:fs/promises'
import * as path from 'node:path'

import { getDomain, getFirstLink } from '../lib/links.ts'
import { getSiteConfig } from './config.ts'
import type { Post } from './posts.ts'

export interface LinkPreview {
  url: string
  domain: string
  title?: string
  description?: string
  image?: string
  // Sites asking for a small card (twitter:card "summary", e.g. profile pages with a square
  // avatar) get a thumbnail beside the text instead of a wide image above it.
  smallImage?: boolean
}

type LinkMetadata = Pick<LinkPreview, 'title' | 'description' | 'image' | 'smallImage'>

// The preview card for a link. Pages never wait on other sites: the first time a link is seen, its
// title, description, and image are fetched in the background and saved to a cache file, and until
// then (or if the site doesn't share them) the card shows just the domain.
async function getLinkPreview(url: string): Promise<LinkPreview> {
  let entries = await loadCache()
  let entry = entries.get(url)
  if (!entry || (entry.failed && Date.now() - entry.fetchedAt > RETRY_FAILED_AFTER)) {
    refresh(url)
  }
  return { url, domain: getDomain(url), ...entry?.metadata }
}

// Text posts get a preview card for the first link in their caption.
export async function getPostLinkPreview(post: Post): Promise<LinkPreview | undefined> {
  let url = post.type === 'text' ? getFirstLink(post.caption) : undefined
  return url ? getLinkPreview(url) : undefined
}

// Kept in tmp/ (gitignored) by default; deleting it just means previews are fetched again.
const CACHE_FILE = path.resolve(process.env.CACHE_DIR ?? 'tmp', 'link-previews.json')
const RETRY_FAILED_AFTER = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT = 5000
const MAX_HTML_BYTES = 512 * 1024

interface CacheEntry {
  fetchedAt: number
  metadata?: LinkMetadata
  failed?: true
}

let cache: Promise<Map<string, CacheEntry>> | undefined
let inFlight = new Set<string>()

function loadCache() {
  cache ??= fsp
    .readFile(CACHE_FILE, 'utf8')
    .then((json) => new Map<string, CacheEntry>(Object.entries(JSON.parse(json))))
    .catch(() => new Map<string, CacheEntry>())
  return cache
}

function refresh(url: string) {
  // Tests shouldn't reach out to the network.
  if (inFlight.has(url) || process.env.NODE_ENV === 'test') return
  inFlight.add(url)

  fetchLinkMetadata(url)
    .then(
      (metadata): CacheEntry => ({ fetchedAt: Date.now(), metadata }),
      (): CacheEntry => ({ fetchedAt: Date.now(), failed: true }),
    )
    .then(async (entry) => {
      let entries = await loadCache()
      entries.set(url, entry)
      await fsp.mkdir(path.dirname(CACHE_FILE), { recursive: true })
      let temp = `${CACHE_FILE}.${process.pid}.tmp`
      await fsp.writeFile(temp, JSON.stringify(Object.fromEntries(entries), null, 2))
      await fsp.rename(temp, CACHE_FILE)
    })
    .catch((error) => console.error(`Couldn't save the link preview for ${url}`, error))
    .finally(() => inFlight.delete(url))
}

async function fetchLinkMetadata(url: string): Promise<LinkMetadata> {
  let response = await fetch(url, {
    headers: { Accept: 'text/html', 'User-Agent': userAgent() },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  })
  if (!response.ok || !response.headers.get('Content-Type')?.includes('text/html')) {
    await response.body?.cancel()
    throw new Error(`Unexpected response: ${response.status}`)
  }
  return parseLinkMetadata(await readStart(response, MAX_HTML_BYTES), response.url)
}

// Names the site, so the sites whose links are previewed can see who's asking.
function userAgent() {
  let { siteUrl } = getSiteConfig()
  return `Mozilla/5.0 (compatible; ${new URL(siteUrl).host} link preview; +${siteUrl})`
}

// The first `limit` bytes of the body, which is plenty to reach the <head>.
async function readStart(response: Response, limit: number) {
  let reader = response.body!.getReader()
  let chunks: Uint8Array[] = []
  let size = 0
  while (size < limit) {
    let chunk = await reader.read()
    if (chunk.done) break
    chunks.push(chunk.value)
    size += chunk.value.byteLength
  }
  await reader.cancel()
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, limit))
}

// Reads a page's Open Graph / Twitter card tags, falling back to <title> and the meta description.
export function parseLinkMetadata(html: string, pageUrl: string): LinkMetadata {
  let headEnd = html.search(/<\/head>/i)
  let head = headEnd === -1 ? html : html.slice(0, headEnd)
  let meta = new Map<string, string>()
  for (let [tag] of head.matchAll(/<meta\s[^>]*>/gi)) {
    let attributes = new Map<string, string>()
    for (let [, name, , doubleQuoted, singleQuoted, bare] of tag.matchAll(
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

  return {
    title: title ? clamp(title, 200) : undefined,
    description: description ? clamp(description, 300) : undefined,
    image: image ? toHttpsUrl(image, pageUrl) : undefined,
    smallImage: meta.get('twitter:card') === 'summary' || undefined,
  }
}

// An absolute https URL, upgrading http so the image isn't blocked as mixed content on this site.
function toHttpsUrl(url: string, base: string) {
  try {
    let resolved = new URL(url, base)
    if (resolved.protocol === 'http:') resolved.protocol = 'https:'
    return resolved.protocol === 'https:' ? resolved.href : undefined
  } catch {
    return undefined
  }
}

function clamp(text: string, length: number) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decodeEntities(text: string) {
  return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (entity, code: string) => {
    if (code[0] !== '#') return NAMED_ENTITIES[code.toLowerCase()] ?? entity
    let point =
      code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity
  })
}
