// `logspace start`: runs the server until it's stopped (SIGINT or SIGTERM), when it finishes the
// requests in flight and closes the database.
import { BunHttpServer } from '@effect/platform-bun'
import { Context, Effect, Layer } from 'effect'
import { HttpRouter } from 'effect/http'

import { AppRoutes, AppServices, ROUTER_CONFIG } from '../app.ts'
import { AppConfig } from '../config.ts'
import { MediaStorage } from '../services/media-storage.ts'
import { VERSION } from './shell.ts'

export const ServerLive = Layer.unwrap(
  Effect.gen(function* () {
    let { port } = yield* AppConfig
    return HttpRouter.serve(AppRoutes, { disableLogger: true, routerConfig: ROUTER_CONFIG }).pipe(
      Layer.provideMerge(AppServices),
      Layer.provide(
        BunHttpServer.layer({
          port,
          // Bun closes a connection after 10 seconds without sending or receiving anything by
          // default, even while a response is being made, like a big photo's first resize.
          // 255 seconds is its longest.
          idleTimeout: 255,
        }),
      ),
    )
  }),
)

export const start = Effect.gen(function* () {
  yield* Effect.log(`LogSpace ${VERSION}`)
  yield* Layer.launch(
    ServerLive.pipe(
      Layer.tap((context) =>
        Effect.log(`Media is stored in ${Context.get(context, MediaStorage).location}`),
      ),
      Layer.provide(AppConfig.layer),
    ),
  )
})
