// The real application and bundled assets, with explicit disposable configuration. This entry
// point never reads AppConfig.layer or .env. All app data stays in the test-owned directory.
import { BunHttpServer, BunRuntime } from '@effect/platform-bun'
import { Context, Effect, Layer, Redacted } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { join } from 'node:path'

import { AppRoutes, AppServices, ROUTER_CONFIG } from '../src/app.ts'
import { AppConfig } from '../src/config.ts'
import { DraftChanges } from '../src/services/draft-changes.ts'
import { PublicNetwork } from '../src/services/public-http.ts'

const [directory, password, secret, port = '0'] = process.argv.slice(2)
if (!directory || !password || !secret)
  throw new Error('Use the browser fixture to start this server')
const config = Layer.succeed(
  AppConfig,
  AppConfig.of({
    port: Number(port),
    hostname: '127.0.0.1',
    mode: 'test',
    trustProxy: false,
    databasePath: join(directory, 'app.sqlite'),
    mediaStorage: 'fs',
    mediaDir: join(directory, 'media'),
    cacheDir: join(directory, 'cache'),
    adminPassword: Redacted.make(password),
    sessionSecret: Redacted.make(secret),
  }),
)

// As in cli/start.ts, end the SSE streams before shutting down the HTTP listener.
const server = Layer.effectDiscard(
  Effect.flatMap(DraftChanges, (changes) => Effect.addFinalizer(() => changes.close)),
).pipe(
  Layer.provideMerge(
    HttpRouter.serve(AppRoutes, { disableLogger: true, routerConfig: ROUTER_CONFIG }),
  ),
  Layer.provideMerge(AppServices.pipe(Layer.provide(PublicNetwork.layer))),
  Layer.provideMerge(
    BunHttpServer.layer({ port: Number(port), hostname: '127.0.0.1', idleTimeout: 255 }),
  ),
  Layer.provide(config),
  Layer.tap((context) =>
    Effect.sync(() => {
      console.log(
        `READY ${HttpServer.formatAddress(Context.get(context, HttpServer.HttpServer).address)}`,
      )
    }),
  ),
)
BunRuntime.runMain(Layer.launch(server))
