// The site's settings, as every page reads them, from the `config` table. Saving them goes
// through commands.ts.
import { Context, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { fromConfigRows, isSiteConfigured, type SavedSiteConfig, type SiteConfig } from './site.ts'

export class SiteConfigQueries extends Context.Service<
  SiteConfigQueries,
  {
    // The config as it's saved, which a site that isn't configured yet lacks some of.
    readonly saved: Effect.Effect<SavedSiteConfig>
  }
>()('logspace/SiteConfigQueries') {
  static readonly layer = Layer.effect(
    SiteConfigQueries,
    Effect.map(SqlClient.SqlClient, (sql) =>
      SiteConfigQueries.of({
        saved: sql<{ key: string; value: string }>`select key, value from config`.pipe(
          Effect.map((rows) => fromConfigRows(new Map(rows.map((row) => [row.key, row.value])))),
          Effect.orDie,
          Effect.withSpan('SiteConfigQueries.saved'),
        ),
      }),
    ),
  )
}

// The site's settings, for what's only served once they're saved (see the gate in
// ../../lib/http/middleware.ts).
export const configuredSite = Effect.flatMap(SiteConfigQueries, (queries) => queries.saved).pipe(
  Effect.flatMap((saved) =>
    isSiteConfigured(saved)
      ? Effect.succeed<SiteConfig>(saved)
      : Effect.die('The site isn’t configured yet'),
  ),
)
