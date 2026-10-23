// The site's settings, as every page reads them: a view of the `config` table, kept in memory and
// rebuilt only when the data changes (see services/data-version.ts). Saving them goes through
// commands/site-config.ts.
import { Context, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { fromConfigRows, type SavedSiteConfig } from '../domain/site.ts'
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
        sql<{ key: string; value: string }>`select key, value from config`.pipe(
          Effect.map((rows) => fromConfigRows(new Map(rows.map((row) => [row.key, row.value])))),
          Effect.orDie,
          Effect.withSpan('SiteConfigQueries.build'),
        ),
      )
      return SiteConfigQueries.of({ saved })
    }),
  )
}
