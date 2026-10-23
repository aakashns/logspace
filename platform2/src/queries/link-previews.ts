// The preview card for the first link in a text post. Pages never wait on other sites: the first
// time a link is seen, its title, description, and image are fetched in the background and saved
// to a cache file, and until then (or if the site doesn't share them) the card shows just the
// domain. Deleting the cache file just means previews are fetched again.
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { Context, Effect, Layer } from 'effect'

import { AppConfig } from '../config.ts'
import { getDomain, getFirstLink } from '../domain/links.ts'
import type { Post } from '../domain/presentation.ts'
import { parseLinkMetadata, type LinkMetadata } from '../domain/link-metadata.ts'
import { SiteConfigQueries } from './site-config.ts'

export interface LinkPreview extends LinkMetadata {
  readonly url: string
  readonly domain: string
}

interface CacheEntry {
  fetchedAt: number
  metadata?: LinkMetadata
  failed?: true
}

const RETRY_FAILED_AFTER = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT = 5000
const MAX_HTML_BYTES = 512 * 1024

export class LinkPreviews extends Context.Service<
  LinkPreviews,
  {
    // Text posts get a preview card for the first link in their caption.
    readonly forPost: (post: Post) => Effect.Effect<LinkPreview | undefined>
  }
>()('logspace/LinkPreviews') {
  static readonly layer = Layer.effect(
    LinkPreviews,
    Effect.gen(function* () {
      let { cacheDir, mode } = yield* AppConfig
      let siteConfig = yield* SiteConfigQueries
      let cacheFile = path.join(cacheDir, 'link-previews.json')
      let entries = yield* Effect.promise(() =>
        fsp
          .readFile(cacheFile, 'utf8')
          .then((json) => new Map<string, CacheEntry>(Object.entries(JSON.parse(json))))
          .catch(() => new Map<string, CacheEntry>()),
      )
      let inFlight = new Set<string>()

      // Saved whole, written beside the cache file and moved into place.
      let saveCache = Effect.promise(async () => {
        await fsp.mkdir(cacheDir, { recursive: true })
        let temp = `${cacheFile}.${process.pid}.${crypto.randomUUID()}.tmp`
        await fsp.writeFile(temp, JSON.stringify(Object.fromEntries(entries), null, 2))
        await fsp.rename(temp, cacheFile)
      })

      let refresh = Effect.fnUntraced(function* (url: string) {
        // Tests shouldn't reach out to the network.
        if (inFlight.has(url) || mode === 'test') return
        inFlight.add(url)
        // Names the site, so the sites whose links are previewed can see who's asking.
        let { siteUrl = '' } = yield* siteConfig.saved
        let userAgent = `Mozilla/5.0 (compatible; ${URL.parse(siteUrl)?.host ?? 'LogSpace'} link preview; +${siteUrl})`
        yield* Effect.tryPromise(() => fetchLinkMetadata(url, userAgent)).pipe(
          Effect.match({
            onSuccess: (metadata): CacheEntry => ({ fetchedAt: Date.now(), metadata }),
            onFailure: (): CacheEntry => ({ fetchedAt: Date.now(), failed: true }),
          }),
          Effect.tap((entry) => Effect.sync(() => entries.set(url, entry))),
          Effect.andThen(saveCache),
          Effect.catchCause((cause) =>
            Effect.logError(`Couldn't save the link preview for ${url}`, cause),
          ),
          Effect.ensuring(Effect.sync(() => inFlight.delete(url))),
          Effect.forkDetach,
        )
      })

      return LinkPreviews.of({
        forPost: Effect.fnUntraced(function* (post) {
          let url = post.type === 'text' ? getFirstLink(post.caption) : undefined
          if (!url) return undefined
          let entry = entries.get(url)
          if (!entry || (entry.failed && Date.now() - entry.fetchedAt > RETRY_FAILED_AFTER)) {
            yield* refresh(url)
          }
          return { url, domain: getDomain(url), ...entry?.metadata }
        }),
      })
    }),
  )
}

async function fetchLinkMetadata(url: string, userAgent: string): Promise<LinkMetadata> {
  let response = await fetch(url, {
    headers: { Accept: 'text/html', 'User-Agent': userAgent },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  })
  if (!response.ok || !response.headers.get('Content-Type')?.includes('text/html')) {
    await response.body?.cancel()
    throw new Error(`Unexpected response: ${response.status}`)
  }
  return parseLinkMetadata(await readStart(response, MAX_HTML_BYTES), response.url)
}

// The first `limit` bytes of the body, which is plenty to reach the <head>.
async function readStart(response: Response, limit: number): Promise<string> {
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
