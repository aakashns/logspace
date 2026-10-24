// Word that the composer's draft changed, for every composer open in a browser to follow along
// (see composerUpdates in http/admin.tsx). The draft itself is in the database: this only says
// when to read it again, as SQLite can't tell its readers about a write. The commands that save,
// publish, or discard the draft say who changed it; the composers subscribe. It's kept in memory,
// as the server is one process.
import { Context, Deferred, Effect, Layer, Stream, SubscriptionRef } from 'effect'
import type { DraftVersion } from '../domain/compose.ts'

export interface DraftChange extends DraftVersion {
  // The composer that made the change (its tab id), if it was one, so it isn't sent back what it
  // already shows.
  readonly by?: string | undefined
}

export class DraftChanges extends Context.Service<
  DraftChanges,
  {
    readonly changed: (by?: string) => Effect.Effect<DraftChange>
    // The latest change (since the server started, if there's been none), then each one after it,
    // until `close`.
    readonly latest: Stream.Stream<DraftChange>
    // Ends every stream of changes, as the server stops.
    readonly close: Effect.Effect<void>
  }
>()('logspace/DraftChanges') {
  static readonly layer = Layer.effect(
    DraftChanges,
    Effect.gen(function* () {
      let ref = yield* SubscriptionRef.make<DraftChange>({
        epoch: crypto.randomUUID(),
        revision: 0,
      })
      let closed = yield* Deferred.make<void>()
      return DraftChanges.of({
        changed: (by) =>
          SubscriptionRef.updateAndGet(ref, ({ epoch, revision }) => ({
            epoch,
            revision: revision + 1,
            by,
          })),
        latest: SubscriptionRef.changes(ref).pipe(Stream.interruptWhen(Deferred.await(closed))),
        close: Deferred.succeed(closed, undefined),
      })
    }),
  )
}
