// The preview card for the first link in a text post. Pages never wait on other sites: the first
// time a link is seen, its title, description, and image are fetched in the background and saved
// to a cache file, and until then (or if the site doesn't share them) the card shows just the
// domain. Deleting the cache file just means previews are fetched again, and so does a cache file
// that can't be read.
import * as path from 'node:path'
import { Clock, Context, Effect, FileSystem, Layer, Option, Schema, Stream } from 'effect'
import { HttpClient } from 'effect/http'

import { AppConfig } from '../config.ts'
import { getDomain, getFirstLink } from '../domain/links.ts'
import type { Post } from '../domain/presentation.ts'
import { LinkMetadata, parseLinkMetadata } from '../domain/link-metadata.ts'
import { SiteConfigQueries } from './site-config.ts'

export interface LinkPreview extends LinkMetadata {
  readonly url: string
  readonly domain: string
}

// A link's metadata, or that it couldn't be fetched, and when.
const CacheEntry = Schema.Struct({
  fetchedAt: Schema.Number,
  metadata: Schema.optionalKey(LinkMetadata),
  failed: Schema.optionalKey(Schema.Literal(true)),
})
type CacheEntry = typeof CacheEntry.Type

const CacheFile = Schema.fromJsonString(Schema.Record(Schema.String, CacheEntry))
const decodeCacheFile = Schema.decodeUnknownEffect(CacheFile)
const encodeCacheFile = Schema.encodeEffect(CacheFile)

// The link's page didn't send HTML.
class NotHtml extends Schema.TaggedError<NotHtml>()('NotHtml', { status: Schema.Number }) {}

const RETRY_FAILED_AFTER = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT = '5 seconds'
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
      let fs = yield* FileSystem.FileSystem
      let client = yield* HttpClient.HttpClient
      let cacheFile = path.join(cacheDir, 'link-previews.json')
      let entries = new Map(
        Object.entries(
          yield* fs.readFileString(cacheFile).pipe(
            Effect.flatMap(decodeCacheFile),
            Effect.catchTag('PlatformError', (error) =>
              error.reason._tag === 'NotFound'
                ? Effect.succeed({})
                : Effect.as(Effect.logWarning(`Couldn't read ${cacheFile}`, error), {}),
            ),
            Effect.catchTag('SchemaError', (error) =>
              Effect.as(Effect.logWarning(`Couldn't read ${cacheFile}`, error), {}),
            ),
          ),
        ),
      )
      let inFlight = new Set<string>()

      // Saved whole, written beside the cache file and moved into place.
      let saveCache = Effect.gen(function* () {
        yield* fs.makeDirectory(cacheDir, { recursive: true })
        let temp = `${cacheFile}.${process.pid}.${crypto.randomUUID()}.tmp`
        yield* fs.writeFileString(temp, yield* encodeCacheFile(Object.fromEntries(entries)))
        yield* fs.rename(temp, cacheFile)
      })

      // Only the start of the page is read, which is plenty to reach the <head>.
      let fetchMetadata = (url: string, userAgent: string) =>
        Effect.gen(function* () {
          let response = yield* client.get(url, {
            headers: { Accept: 'text/html', 'User-Agent': userAgent },
          })
          let ok = response.status >= 200 && response.status < 300
          if (!ok || !response.headers['content-type']?.includes('text/html')) {
            return yield* new NotHtml({ status: response.status })
          }
          let size = 0
          let chunks = yield* response.stream.pipe(
            Stream.takeUntil((chunk) => (size += chunk.byteLength) >= MAX_HTML_BYTES),
            Stream.runCollect,
          )
          let html = new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_HTML_BYTES))
          return parseLinkMetadata(html, response.url)
        }).pipe(Effect.scoped, Effect.timeout(FETCH_TIMEOUT))

      let refresh = Effect.fnUntraced(function* (url: string) {
        // Tests shouldn't reach out to the network.
        if (inFlight.has(url) || mode === 'test') return
        inFlight.add(url)
        // Names the site, so the sites whose links are previewed can see who's asking.
        let { siteUrl = '' } = yield* siteConfig.saved
        let userAgent = `Mozilla/5.0 (compatible; ${URL.parse(siteUrl)?.host ?? 'LogSpace'} link preview; +${siteUrl})`
        yield* fetchMetadata(url, userAgent).pipe(
          Effect.option,
          Effect.flatMap((metadata) =>
            Effect.map(Clock.currentTimeMillis, (fetchedAt): CacheEntry =>
              Option.match(metadata, {
                onSome: (metadata) => ({ fetchedAt, metadata }),
                onNone: () => ({ fetchedAt, failed: true }),
              }),
            ),
          ),
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
          let now = yield* Clock.currentTimeMillis
          if (!entry || (entry.failed && now - entry.fetchedAt > RETRY_FAILED_AFTER)) {
            yield* refresh(url)
          }
          return { url, domain: getDomain(url), ...entry?.metadata }
        }),
      })
    }),
  )
}
