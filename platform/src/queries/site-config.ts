// The site's settings, as every page reads them: a view of the `config` table, kept in memory and
// rebuilt only when the data changes (see services/data-version.ts). Saving them goes through
// commands/site-config.ts.
import { Context, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import {
  DEFAULT_SITE_CONFIG,
  SITE_IMAGE_KINDS,
  TEXT_SETTINGS,
  decodeSiteImage,
  type SavedSiteConfig,
} from '../domain/site.ts'
import { makeView } from '../services/data-version.ts'

export class SiteConfigQueries extends Context.Service<
  SiteConfigQueries,
  {
    // The config as it's saved, which a site that isn't configured yet lacks some of.
    readonly saved: Effect.Effect<SavedSiteConfig>
  }
>()('logspace/SiteConfigQueries') {
  static readonly layer = Layer.effect(
    SiteConfigQueries,
    Effect.gen(function* () {
      let sql = yield* SqlClient.SqlClient
      let saved = yield* makeView(
        Effect.gen(function* () {
          let config: Record<string, unknown> = { ...DEFAULT_SITE_CONFIG }
          for (let { key, value } of yield* sql<{
            key: string
            value: string
          }>`select key, value from config`) {
            if ((TEXT_SETTINGS as readonly string[]).includes(key)) config[key] = value
            if ((SITE_IMAGE_KINDS as readonly string[]).includes(key)) {
              // A mangled row is ignored, like a missing one.
              let image = decodeSiteImage(value)
              if (image) config[key] = image
            }
          }
          return config as SavedSiteConfig
        }).pipe(Effect.orDie, Effect.withSpan('SiteConfigQueries.build')),
      )
      return SiteConfigQueries.of({ saved })
    }),
  )
}
