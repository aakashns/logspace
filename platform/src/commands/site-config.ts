// Saving the site's settings from /admin/config: the write side for the `config` table and the
// site's image files.
import { Context, Effect, Layer } from 'effect'
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
import { DataVersion } from '../services/data-version.ts'
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
      let versions = yield* DataVersion

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
        yield* versions.changed
      })

      let removeImageFiles = (image: SiteImage) =>
        Effect.forEach(
          image.file === 'icon-512.png' ? ICON_FILES : [image.file],
          (name) => storage.remove(mediaKeys.siteFile(name)),
          { discard: true },
        )

      // Uploads are turned into the files they're served as first, but only stored once
      // everything is valid. An image's old files are removed after its new ones are stored, and
      // the config is saved last, so if a step fails the config still names files that exist.
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
        let hasSocialImage =
          processed.has('socialImage') || (current.socialImage && !removals.includes('socialImage'))
        if (hasSocialImage && !text.socialImageAlt) {
          issues.push({ field: 'socialImageAlt', message: 'Describe the social preview image' })
        }
        if (parsed._tag === 'Failure' || issues.length > 0) {
          return yield* new SiteConfigRejected({ issues })
        }

        for (let [kind, upload] of processed) {
          for (let file of upload.files)
            yield* storage.put(mediaKeys.siteFile(file.name), file.bytes)
          // The replaced image's files that the new one doesn't overwrite.
          let previous = current[kind]
          if (previous && !upload.files.some((file) => file.name === previous.file)) {
            yield* removeImageFiles(previous)
          }
          current[kind] = upload.image
        }
        for (let kind of removals) {
          let image = current[kind]
          if (image) yield* removeImageFiles(image)
          delete current[kind]
        }
        yield* save({ ...parsed.success, ...current })
      })

      return SiteConfigCommands.of({ update, save })
    }),
  )
}
