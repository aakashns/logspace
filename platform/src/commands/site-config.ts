// Saving the site's settings from /admin/config: the write side for the `config` table and the
// site's image files.
import { Context, Effect, Layer, Semaphore } from 'effect'
import { SqlClient } from 'effect/sql'

import {
  SITE_IMAGE_KINDS,
  TEXT_SETTINGS,
  parseSiteText,
  type SiteConfig,
  type SiteConfigIssue,
  type SiteImage,
  type SiteImageKind,
  type SiteText,
} from '../domain/site.ts'
import { SiteConfigQueries } from '../queries/site-config.ts'
import { ICON_FILES, Images, type ProcessedSiteImage } from '../services/images.ts'
import { MediaStorage, mediaKeys } from '../services/media-storage.ts'
import { SiteConfigRejected } from './errors.ts'

export class SiteConfigCommands extends Context.Service<
  SiteConfigCommands,
  {
    // Saves the /admin/config form: its settings, and images to upload or remove.
    readonly update: (
      text: SiteText,
      uploads: Partial<Record<SiteImageKind, Blob>>,
      removals: readonly SiteImageKind[],
    ) => Effect.Effect<void, SiteConfigRejected>
    // Saves every setting, replacing the saved ones. An image that's left out is removed.
    readonly save: (config: SiteConfig) => Effect.Effect<void>
  }
>()('logspace/SiteConfigCommands') {
  static readonly layer = Layer.effect(
    SiteConfigCommands,
    Effect.gen(function* () {
      let sql = yield* SqlClient.SqlClient
      let storage = yield* MediaStorage
      let images = yield* Images
      let queries = yield* SiteConfigQueries
      let mutations = yield* Semaphore.make(1)

      let save = Effect.fn('SiteConfigCommands.save')(function* (config: SiteConfig) {
        let rows = [...TEXT_SETTINGS, ...SITE_IMAGE_KINDS].flatMap((key) => {
          let value = config[key]
          if (value === undefined) return []
          return [{ key, value: typeof value === 'string' ? value : JSON.stringify(value) }]
        })
        yield* sql
          .withTransaction(
            Effect.gen(function* () {
              yield* sql`delete from config where ${sql.in('key', [...TEXT_SETTINGS, ...SITE_IMAGE_KINDS])}`
              if (rows.length > 0) yield* sql`insert into config ${sql.insert(rows)}`
            }),
          )
          .pipe(Effect.orDie)
      })

      let removeImageFiles = (image: SiteImage) =>
        Effect.forEach(
          image.file === 'icon-512.png' ? ICON_FILES : [image.file],
          (name) => storage.remove(mediaKeys.siteFile(name, image.generation)),
          { discard: true },
        )
      // The banner's resized copies, made from a version of it that's gone.
      let removeVariants = (image: SiteImage) =>
        Effect.flatMap(storage.list(mediaKeys.siteVariants(image.file)), (files) =>
          Effect.forEach(
            files.filter((file) => file.key.endsWith(`-${image.version}.webp`)),
            (file) => storage.remove(file.key),
            { discard: true },
          ),
        )

      // Stage every file in a fresh generation before committing the config. A failed write or
      // transaction leaves the old generation usable, even for the four-file icon. Cleanup after
      // commit is best effort: failure leaves unreferenced files, never missing published media.
      let update = Effect.fn('SiteConfigCommands.update')(function* (
        text: SiteText,
        uploads: Partial<Record<SiteImageKind, Blob>>,
        removals: readonly SiteImageKind[],
      ) {
        let parsed = parseSiteText(text)
        let issues: SiteConfigIssue[] = parsed._tag === 'Failure' ? [...parsed.failure] : []
        let processed = new Map<SiteImageKind, ProcessedSiteImage>()
        for (let kind of SITE_IMAGE_KINDS) {
          let upload = uploads[kind]
          if (!upload) continue
          let bytes = new Uint8Array(yield* Effect.promise(() => upload.arrayBuffer()))
          yield* images.processSiteImage(kind, bytes).pipe(
            Effect.match({
              onSuccess: (image) => void processed.set(kind, image),
              onFailure: (error) => void issues.push({ field: kind, message: error.message }),
            }),
          )
        }
        let saved = yield* queries.saved
        let current: { [K in SiteImageKind]?: SiteImage } = {}
        for (let kind of SITE_IMAGE_KINDS) {
          let image = saved[kind]
          if (image) current[kind] = image
        }
        let hasBannerImage =
          processed.has('bannerImage') || (current.bannerImage && !removals.includes('bannerImage'))
        if (hasBannerImage && !text.bannerImageAlt) {
          issues.push({ field: 'bannerImageAlt', message: 'Describe the banner image' })
        }
        if (parsed._tag === 'Failure' || issues.length > 0) {
          return yield* new SiteConfigRejected({ issues })
        }

        for (let [kind, upload] of processed) {
          if (removals.includes(kind)) continue
          let generation = crypto.randomUUID()
          for (let file of upload.files)
            yield* storage.put(mediaKeys.siteFile(file.name, generation), file.bytes)
          current[kind] = { ...upload.image, generation }
        }
        for (let kind of removals) delete current[kind]
        yield* save({ ...parsed.success, ...current })
        for (let kind of SITE_IMAGE_KINDS) {
          let previous = saved[kind]
          if (!previous || previous === current[kind]) continue
          yield* removeImageFiles(previous).pipe(
            Effect.andThen(
              current[kind]?.file === previous.file && current[kind]?.version === previous.version
                ? Effect.void
                : removeVariants(previous),
            ),
            Effect.catchCause((cause) => Effect.logWarning('Site image cleanup failed', cause)),
          )
        }
      })

      return SiteConfigCommands.of({
        update: (...args) => mutations.withPermit(Effect.uninterruptible(update(...args))),
        save: (...args) => mutations.withPermit(Effect.uninterruptible(save(...args))),
      })
    }),
  )
}
