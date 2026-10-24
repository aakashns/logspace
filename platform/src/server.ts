// The shared Bun server: routes, application services, and graceful shutdown, given AppConfig.
import { BunHttpServer } from '@effect/platform-bun'
import { Effect, Layer } from 'effect'
import { HttpRouter } from 'effect/http'

import { AppLive, AppRoutes, ROUTER_CONFIG } from './app.ts'
import { AppConfig } from './config.ts'
import { DraftChanges } from './services/draft-changes.ts'

// The composers' streams of updates never finish on their own, so they're ended as the server
// starts to stop, rather than kept to its graceful shutdown's timeout (20 seconds). A layer's
// finalizers run before those of the layers it's built on, so this runs before the server's.
const EndDraftStreams = Layer.effectDiscard(
  Effect.flatMap(DraftChanges, (changes) => Effect.addFinalizer(() => changes.close)),
)

// Retain the app services and listener for startup logging and the browser fixture's address.
export const ServerLive = Layer.unwrap(
  Effect.gen(function* () {
    let { port, hostname } = yield* AppConfig
    return EndDraftStreams.pipe(
      Layer.provide(
        HttpRouter.serve(AppRoutes, { disableLogger: true, routerConfig: ROUTER_CONFIG }),
      ),
      Layer.provideMerge(AppLive),
      Layer.provideMerge(
        BunHttpServer.layer({
          port,
          hostname,
          // Bun closes a connection after 10 seconds without sending or receiving anything by
          // default, even while a response is being made, like a big photo's first resize.
          // 255 seconds is its longest.
          idleTimeout: 255,
        }),
      ),
    )
  }),
)
