// The preview card for the first link in a text post. Pages never wait on other sites: the first
// time a link is seen, its title, description, and image are fetched in the background and saved
// to a cache file, and until then (or if the site doesn't share them) the card shows just the
// domain. Deleting the cache file just means previews are fetched again, and so does a cache file
// that can't be read.
//
// The image is fetched with the rest, and saved to media storage as WebP copies at the widths
// pages show photos at, so the card loads from this site, at the size it's shown, and readers'
// browsers don't ask the other site for anything. A preview is saved once its image is, and
// without it if it can't be fetched or read (it's tried again later, like a page that couldn't
// be fetched).
import * as path from 'node:path'
import { Clock, Context, Effect, FileSystem, Layer, Option, Schema, Stream } from 'effect'
import { HttpClient } from 'effect/http'

import { AppConfig } from '../config.ts'
import { getResizedSources, type ImageInfo } from '../domain/images.ts'
import { getDomain, getFirstLink } from '../domain/links.ts'
import type { Photo, Post } from '../domain/presentation.ts'
import { LinkMetadata, parseLinkMetadata } from '../domain/link-metadata.ts'
import { routes } from '../routes.ts'
import { Images } from '../services/images.ts'
import { MediaStorage, mediaKeys, type StoredFile } from '../services/media-storage.ts'
import { SiteConfigQueries } from './site-config.ts'

export interface LinkPreview {
  readonly url: string
  readonly domain: string
  readonly title?: string | undefined
  readonly description?: string | undefined
  // The saved copy of the link's image.
  readonly image?: Photo | undefined
  readonly smallImage?: boolean | undefined
}

// A link's metadata and its image's saved copy, or that one of them couldn't be fetched, and
// when. A preview with an image URL but no copy (and not failed) was saved before images were.
const CacheEntry = Schema.Struct({
  fetchedAt: Schema.Number,
  metadata: Schema.optionalKey(LinkMetadata),
  image: Schema.optionalKey(
    Schema.Struct({ width: Schema.Number, height: Schema.Number, version: Schema.String }),
  ),
  failed: Schema.optionalKey(Schema.Literal(true)),
})
type CacheEntry = typeof CacheEntry.Type

const CacheFile = Schema.fromJsonString(Schema.Record(Schema.String, CacheEntry))
const decodeCacheFile = Schema.decodeUnknownEffect(CacheFile)
const encodeCacheFile = Schema.encodeEffect(CacheFile)

// The link's page didn't send HTML.
class NotHtml extends Schema.TaggedError<NotHtml>()('NotHtml', { status: Schema.Number }) {}

// The link's image isn't one this site will show: not an image, too big, or one Bun can't read.
class ImageRefused extends Schema.TaggedError<ImageRefused>()('ImageRefused', {
  reason: Schema.String,
}) {}

const RETRY_FAILED_AFTER = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT = '5 seconds'
const MAX_HTML_BYTES = 512 * 1024
// Link images are usually about 1200 × 630 and well under 1 MB. The pixel limit is checked from
// the image's header, before it's decoded, so a small file can't claim a huge canvas.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_IMAGE_PIXELS = 25_000_000
// A saved image's files, as routes.linkImage names them.
const LINK_IMAGE_NAME = /^[0-9a-f]{12}-\d+\.webp$/

export class LinkPreviews extends Context.Service<
  LinkPreviews,
  {
    // Text posts get a preview card for the first link in their caption.
    readonly forPost: (post: Post) => Effect.Effect<LinkPreview | undefined>
    // A saved link image's file, by the name in its URL.
    readonly image: (name: string) => Effect.Effect<StoredFile | undefined>
  }
>()('logspace/LinkPreviews') {
  static readonly layer = Layer.effect(
    LinkPreviews,
    Effect.gen(function* () {
      let { cacheDir, mode } = yield* AppConfig
      let siteConfig = yield* SiteConfigQueries
      let storage = yield* MediaStorage
      let images = yield* Images
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

      // The image, read whole (a part of one is no use), then resized to each width it's shown
      // at. Links to the same image share its copies.
      let saveImage = (url: string, userAgent: string) =>
        Effect.gen(function* () {
          let bytes = yield* Effect.gen(function* () {
            let response = yield* client.get(url, {
              headers: { Accept: 'image/*', 'User-Agent': userAgent },
            })
            let ok = response.status >= 200 && response.status < 300
            if (!ok || !response.headers['content-type']?.startsWith('image/')) {
              return yield* new ImageRefused({ reason: `not an image (${response.status})` })
            }
            let size = 0
            let chunks = yield* response.stream.pipe(
              Stream.takeUntil((chunk) => (size += chunk.byteLength) > MAX_IMAGE_BYTES),
              Stream.runCollect,
            )
            if (size > MAX_IMAGE_BYTES) return yield* new ImageRefused({ reason: 'too big' })
            return new Uint8Array(Buffer.concat(chunks))
          }).pipe(Effect.scoped, Effect.timeout(FETCH_TIMEOUT))
          let info = yield* images.readInfo(bytes)
          if (!info || info.width * info.height > MAX_IMAGE_PIXELS) {
            return yield* new ImageRefused({ reason: info ? 'too many pixels' : 'unreadable' })
          }
          for (let { param } of getResizedSources(info)) {
            let key = mediaKeys.linkImage(`${info.version}-${param}.webp`)
            if (!(yield* storage.has(key))) {
              yield* storage.put(key, yield* images.resize(bytes, param))
            }
          }
          return info
        })

      // The page's metadata, then its image.
      let fetchEntry = (url: string, userAgent: string) =>
        Effect.gen(function* () {
          let metadata = yield* Effect.option(fetchMetadata(url, userAgent))
          let image = Option.isSome(metadata) && metadata.value.image
          let saved = image ? yield* Effect.option(saveImage(image, userAgent)) : Option.none()
          let fetchedAt = yield* Clock.currentTimeMillis
          return Option.match(metadata, {
            onNone: (): CacheEntry => ({ fetchedAt, failed: true }),
            onSome: (metadata): CacheEntry =>
              Option.match(saved, {
                onSome: (image) => ({ fetchedAt, metadata, image }),
                onNone: () =>
                  image ? { fetchedAt, metadata, failed: true } : { fetchedAt, metadata },
              }),
          })
        })

      let refresh = Effect.fnUntraced(function* (url: string) {
        // Tests shouldn't reach out to the network.
        if (inFlight.has(url) || mode === 'test') return
        inFlight.add(url)
        // Names the site, so the sites whose links are previewed can see who's asking.
        let { siteUrl = '' } = yield* siteConfig.saved
        let userAgent = `Mozilla/5.0 (compatible; ${URL.parse(siteUrl)?.host ?? 'LogSpace'} link preview; +${siteUrl})`
        yield* fetchEntry(url, userAgent).pipe(
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
          let stale = entry?.failed
            ? now - entry.fetchedAt > RETRY_FAILED_AFTER
            : entry?.metadata?.image !== undefined && !entry.image
          if (!entry || stale) yield* refresh(url)
          return {
            url,
            domain: getDomain(url),
            title: entry?.metadata?.title,
            description: entry?.metadata?.description,
            image: entry?.image && linkImage(entry.image),
            smallImage: entry?.metadata?.smallImage,
          }
        }),
        image: (name) =>
          LINK_IMAGE_NAME.test(name)
            ? storage.get(mediaKeys.linkImage(name))
            : Effect.succeed(undefined),
      })
    }),
  )
}

// A saved link image, as the card shows it: its largest copy, and the rest for srcset. It's
// decorative, since the card's text says what it is.
function linkImage(info: ImageInfo): Photo | undefined {
  let sources = getResizedSources(info)
  let largest = sources.at(-1)
  if (!largest) return undefined
  let url = (param: number) => routes.linkImage(info.version, param)
  return {
    src: url(largest.param),
    srcset: sources.map((source) => `${url(source.param)} ${source.width}w`).join(', '),
    alt: '',
    width: info.width,
    height: info.height,
  }
}
