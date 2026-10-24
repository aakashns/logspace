// The shared Bun server: routes, application services, and graceful shutdown, given AppConfig.
import { BunHttpServer } from '@effect/platform-bun'
import { Effect, Layer } from 'effect'
import { HttpRouter } from 'effect/http'

import { AppLive, AppRoutes, ROUTER_CONFIG } from './app.ts'
import { AppConfig } from './config.ts'

// Retain the app services and listener for startup logging and the browser fixture's address.
export const ServerLive = Layer.unwrap(
  Effect.gen(function* () {
    let { port, hostname } = yield* AppConfig
    return HttpRouter.serve(AppRoutes, { disableLogger: true, routerConfig: ROUTER_CONFIG }).pipe(
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
