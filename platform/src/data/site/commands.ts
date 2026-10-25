// Saving the site's settings from /admin/branding and /admin/integrations: the write side for the
// `config` table and the site's image files.
import { Context, Effect, Layer, Schema, Semaphore } from 'effect'
import { SqlClient } from 'effect/sql'

import { ICON_FILES, Images, type ProcessedSiteImage } from '../../lib/images.ts'
import { MediaStorage, mediaKeys } from '../../lib/media-storage.ts'
import { Secrets } from '../../lib/secrets.ts'
import { Email } from './email.ts'
import { SiteConfigQueries } from './queries.ts'
import {
  checkEmailForm,
  EMAIL_SECRET_PURPOSES,
  type EmailForm,
  type EmailSettings,
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
} from './site.ts'
import { SUBSCRIPTIONS_BLOCKERS, subscriptionsStatus } from './subscriptions.ts'
import { Turnstile } from './turnstile.ts'

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

// The email settings weren't saved, for these reasons (shown in its section of
// /admin/integrations).
export class EmailSettingsRejected extends Schema.TaggedError<EmailSettingsRejected>()(
  'EmailSettingsRejected',
  {
    issues: Schema.Array(
      Schema.Struct({
        field: Schema.Literals([
          'provider',
          'fromName',
          'from',
          'replyTo',
          'sesRegion',
          'sesEndpoint',
          'sesAccessKeyId',
          'sesSecretAccessKey',
          'resendApiKey',
        ]),
        message: Schema.String,
      }),
    ),
  },
) {}

// Subscriptions weren't switched on: these are missing (see subscriptions.ts).
export class SubscriptionsNotReady extends Schema.TaggedError<SubscriptionsNotReady>()(
  'SubscriptionsNotReady',
  {
    missing: Schema.Array(Schema.Literals(SUBSCRIPTIONS_BLOCKERS)),
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
    // Saves Turnstile's keys, sealing the secret key, and whether logging in requires it. An
    // empty secret key keeps the saved one.
    readonly saveTurnstile: (
      keys: TurnstileKeys,
      enabled: boolean,
    ) => Effect.Effect<void, TurnstileKeysRejected>
    // Saves how the site sends email, sealing its secret access key or API key. One left empty
    // keeps the saved one.
    readonly saveEmail: (form: EmailForm) => Effect.Effect<void, EmailSettingsRejected>
    // Switches subscribing on or off. It's switched on only while nothing it needs is missing.
    readonly saveSubscriptions: (enabled: boolean) => Effect.Effect<void, SubscriptionsNotReady>
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
      let services = Context.make(SiteConfigQueries, queries).pipe(
        Context.add(Email, yield* Email),
        Context.add(Turnstile, yield* Turnstile),
      )
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
        yield* write([...BRANDING_SETTINGS, ...INTEGRATIONS, 'subscriptions'], config)
      })

      let saveTurnstile = Effect.fn('SiteConfigCommands.saveTurnstile')(function* (
        keys: TurnstileKeys,
        enabled: boolean,
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
        yield* write(['turnstile'], { turnstile: { siteKey: keys.siteKey, secretKey, enabled } })
      })

      let saveEmail = Effect.fn('SiteConfigCommands.saveEmail')(function* (form: EmailForm) {
        let purpose = EMAIL_SECRET_PURPOSES[form.provider === 'resend' ? 'resend' : 'ses']
        // The secret saved for the provider chosen, if it's the saved one.
        let saved = (yield* queries.saved).email?.provider
        let sealed =
          saved?._tag !== form.provider
            ? undefined
            : saved._tag === 'ses'
              ? saved.secretAccessKey
              : saved.apiKey
        let state: SavedSecret = sealed
          ? yield* secrets.open(sealed, purpose).pipe(
              Effect.match({
                onSuccess: () => 'readable' as const,
                onFailure: () => 'unreadable' as const,
              }),
            )
          : 'none'
        let checked = checkEmailForm(form, state)
        if (checked._tag === 'Failure') {
          return yield* new EmailSettingsRejected({ issues: checked.failure })
        }
        let { secret, provider, ...addresses } = checked.success
        // Without a new one, the checks passed only because the saved one opens.
        let kept = secret ? yield* secrets.seal(secret, purpose) : sealed
        if (!kept) return yield* Effect.die('A secret was checked but not found')
        let email: EmailSettings = {
          ...addresses,
          provider:
            provider._tag === 'ses'
              ? { ...provider, secretAccessKey: kept }
              : { ...provider, apiKey: kept },
        }
        yield* write(['email'], { email })
      })

      let saveSubscriptions = Effect.fn('SiteConfigCommands.saveSubscriptions')(function* (
        enabled: boolean,
      ) {
        if (enabled) {
          let status = yield* Effect.provideContext(subscriptionsStatus, services)
          if (status._tag === 'Off' && status.missing.length > 0) {
            return yield* new SubscriptionsNotReady({ missing: status.missing })
          }
        }
        yield* write(['subscriptions'], { subscriptions: { enabled } })
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
        saveTurnstile: (keys, enabled) =>
          mutations.withPermit(Effect.uninterruptible(saveTurnstile(keys, enabled))),
        saveEmail: (form) => mutations.withPermit(Effect.uninterruptible(saveEmail(form))),
        saveSubscriptions: (enabled) =>
          mutations.withPermit(Effect.uninterruptible(saveSubscriptions(enabled))),
        removeIntegration: (integration) =>
          mutations.withPermit(Effect.uninterruptible(removeIntegration(integration))),
        save: (...args) => mutations.withPermit(Effect.uninterruptible(save(...args))),
      })
    }),
  )
}
