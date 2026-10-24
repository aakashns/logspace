// The site's settings, as every page reads them, from the `config` table. Saving them goes
// through commands/site-config.ts.
import { Context, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { fromConfigRows, type SavedSiteConfig } from '../domain/site.ts'

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
