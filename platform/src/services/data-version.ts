// How the read side knows its cached views are stale.
//
// Pages don't query the database. They read views (the presented posts, the site's settings)
// that queries/ builds once and keeps until the data changes. The data changes in two ways:
//
// - This process writes it. Every command calls `changed` after it writes, which bumps a counter.
// - Another process writes it (`logspace migrate`, or someone with sqlite3). SQLite's
//   `PRAGMA data_version` changes when another connection commits, and costs about a
//   microsecond to read, so it's checked on every read.
//
// A view is current while `current` returns the same value it was built at.
import { Context, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

export class DataVersion extends Context.Service<
  DataVersion,
  {
    readonly current: Effect.Effect<string>
    readonly changed: Effect.Effect<void>
  }
>()('logspace/DataVersion') {
  static readonly layer = Layer.effect(
    DataVersion,
    Effect.gen(function* () {
      let sql = yield* SqlClient.SqlClient
      let writes = 0
      let externalVersion = sql<{ data_version: number }>`PRAGMA data_version`.pipe(
        Effect.map(([row]) => row.data_version),
        Effect.orDie,
      )
      return DataVersion.of({
        current: Effect.map(externalVersion, (version) => `${writes}:${version}`),
        changed: Effect.sync(() => {
          writes++
        }),
      })
    }),
  )
}

// A value built from the database, rebuilt when the data version changes. Concurrent reads of a
// stale view share one rebuild.
export const makeView = <A, E, R>(build: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    let versions = yield* DataVersion
    let cached: { version: string; value: Effect.Effect<A, E> } | undefined
    let context = yield* Effect.context<R>()
    return Effect.gen(function* () {
      let version = yield* versions.current
      if (cached?.version !== version) {
        let value = yield* Effect.cached(Effect.provideContext(build, context))
        cached = { version, value }
      }
      let result = yield* Effect.exit(cached.value)
      // A failed build isn't kept: the next read tries again.
      if (result._tag === 'Failure' && cached.version === version) cached = undefined
      return yield* result
    })
  })
