// `logspace start`: runs the server until it's stopped (SIGINT or SIGTERM), when it finishes the
// requests in flight and closes the database.
import { Context, Effect, Layer } from 'effect'

import { AppConfig } from '../lib/config.ts'
import { MediaStorage } from '../lib/media-storage.ts'
import { ServerLive } from '../server.ts'
import { VERSION } from './shell.ts'

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
