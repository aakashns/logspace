// Saving the site's settings from /admin/branding and /admin/integrations: the write side for the
// `config` table and the site's image files.
import { Context, Effect, Layer, Schema, Semaphore } from 'effect'
import { SqlClient } from 'effect/sql'

import { ICON_FILES, Images, type ProcessedSiteImage } from '../../lib/images.ts'
import { MediaStorage, mediaKeys } from '../../lib/media-storage.ts'
import { Secrets } from '../../lib/secrets.ts'
import { SiteConfigQueries } from './queries.ts'
import {
  INTEGRATIONS,
  SITE_CONFIG_FIELDS,
  SITE_IMAGE_KINDS,
  TEXT_SETTINGS,
  TURNSTILE_SECRET_PURPOSE,
  checkTurnstileKeys,
  parseSiteText,
  type Integration,
  type SavedSecret,
  type SiteConfig,
  type SiteConfigIssue,
  type SiteImage,
  type SiteImageKind,
  type SiteText,
  type TurnstileKeys,
  type TurnstileSettings,
} from './site.ts'

// The site's settings weren't saved, for these reasons (shown above the config form). It's
// expected: the page that sent the command shows why.
export class SiteConfigRejected extends Schema.TaggedError<SiteConfigRejected>()(
  'SiteConfigRejected',
  {
    issues: Schema.Array(
      Schema.Struct({
        field: Schema.optionalKey(Schema.Literals(SITE_CONFIG_FIELDS)),
        message: Schema.String,
      }),
    ),
  },
) {}

// Turnstile's keys weren't saved, for these reasons (shown in its section of
// /admin/integrations).
export class TurnstileKeysRejected extends Schema.TaggedError<TurnstileKeysRejected>()(
  'TurnstileKeysRejected',
  {
    issues: Schema.Array(
      Schema.Struct({ field: Schema.Literals(['siteKey', 'secretKey']), message: Schema.String }),
    ),
  },
) {}

// The settings /admin/branding saves.
const BRANDING_SETTINGS = [...TEXT_SETTINGS, ...SITE_IMAGE_KINDS] as const

export class SiteConfigCommands extends Context.Service<
  SiteConfigCommands,
  {
    // Saves the /admin/branding form: its settings, and images to upload or remove. The
    // integrations are left as they are.
    readonly update: (
      text: SiteText,
      uploads: Partial<Record<SiteImageKind, Blob>>,
      removals: readonly SiteImageKind[],
    ) => Effect.Effect<void, SiteConfigRejected>
    // Saves Turnstile's keys, sealing the secret key. An empty secret key keeps the saved one.
    // Where the old keys worked is forgotten.
    readonly saveTurnstile: (keys: TurnstileKeys) => Effect.Effect<void, TurnstileKeysRejected>
    // Keeps the site Cloudflare accepted an answer from, made with these keys, unless they've
    // been replaced since.
    readonly saveTurnstileHostname: (
      keys: TurnstileSettings,
      hostname: string,
    ) => Effect.Effect<void>
    // Disconnects an integration, forgetting its settings. Removing one that isn't set up does
    // nothing.
    readonly removeIntegration: (integration: Integration) => Effect.Effect<void>
    // Saves every setting, replacing the saved ones. An image or integration that's left out is
    // removed.
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
      let secrets = yield* Secrets
      let mutations = yield* Semaphore.make(1)

      // Replaces these settings with the config's, removing those it leaves out.
      let write = (keys: readonly (keyof SiteConfig)[], config: Partial<SiteConfig>) => {
        let rows = keys.flatMap((key) => {
          let value = config[key]
          if (value === undefined) return []
          return [{ key, value: typeof value === 'string' ? value : JSON.stringify(value) }]
        })
        return sql
          .withTransaction(
            Effect.gen(function* () {
              yield* sql`delete from config where ${sql.in('key', keys)}`
              if (rows.length > 0) yield* sql`insert into config ${sql.insert(rows)}`
            }),
          )
          .pipe(Effect.orDie)
      }

      let save = Effect.fn('SiteConfigCommands.save')(function* (config: SiteConfig) {
        yield* write([...BRANDING_SETTINGS, ...INTEGRATIONS], config)
      })

      let saveTurnstile = Effect.fn('SiteConfigCommands.saveTurnstile')(function* (
        keys: TurnstileKeys,
      ) {
        let saved = (yield* queries.saved).turnstile
        let state: SavedSecret = saved
          ? yield* secrets.open(saved.secretKey, TURNSTILE_SECRET_PURPOSE).pipe(
              Effect.match({
                onSuccess: () => 'readable' as const,
                onFailure: () => 'unreadable' as const,
              }),
            )
          : 'none'
        let issues = checkTurnstileKeys(keys, state)
        if (issues.length > 0) return yield* new TurnstileKeysRejected({ issues })
        // Without a new secret key, the checks passed only because the saved one opens.
        let secretKey =
          keys.secretKey || !saved
            ? yield* secrets.seal(keys.secretKey, TURNSTILE_SECRET_PURPOSE)
            : saved.secretKey
        yield* write(['turnstile'], { turnstile: { siteKey: keys.siteKey, secretKey } })
      })

      let saveTurnstileHostname = Effect.fn('SiteConfigCommands.saveTurnstileHostname')(function* (
        keys: TurnstileSettings,
        hostname: string,
      ) {
        let saved = (yield* queries.saved).turnstile
        if (saved?.siteKey !== keys.siteKey || saved.secretKey !== keys.secretKey) return
        yield* write(['turnstile'], { turnstile: { ...saved, verifiedHostname: hostname } })
      })

      let removeIntegration = Effect.fn('SiteConfigCommands.removeIntegration')(function* (
        integration: Integration,
      ) {
        yield* write([integration], {})
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
        yield* write(BRANDING_SETTINGS, { ...parsed.success, ...current })
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
        saveTurnstile: (keys) => mutations.withPermit(Effect.uninterruptible(saveTurnstile(keys))),
        saveTurnstileHostname: (keys, hostname) =>
          mutations.withPermit(Effect.uninterruptible(saveTurnstileHostname(keys, hostname))),
        removeIntegration: (integration) =>
          mutations.withPermit(Effect.uninterruptible(removeIntegration(integration))),
        save: (...args) => mutations.withPermit(Effect.uninterruptible(save(...args))),
      })
    }),
  )
}
