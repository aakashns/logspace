// The real application and bundled assets, with explicit disposable configuration. This entry
// point never reads AppConfig.layer or .env. All app data stays in the test-owned directory.
import { BunHttpServer, BunFileSystem } from '@effect/platform-bun'
import { browserUpdates } from './updates.ts'
import { BunRuntime } from '@effect/platform-bun'
import { Context, Effect, Layer, Redacted } from 'effect'
import { HttpServer, HttpRouter } from 'effect/http'
import { join } from 'node:path'

import { AppConfig } from '../src/lib/config.ts'
import { ServerLive, AppLive, AppRoutes } from '../src/server.ts'

const [directory, password, secret] = process.argv.slice(2)
if (!directory || !password || !secret)
  throw new Error('Use the browser fixture to start this server')
const config = Layer.succeed(
  AppConfig,
  AppConfig.of({
    port: 0,
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

const live =
  process.argv[5] === 'updates'
    ? HttpRouter.serve(AppRoutes, { disableLogger: true }).pipe(
        Layer.provideMerge(
          Layer.merge(AppLive, browserUpdates(directory).pipe(Layer.provide(BunFileSystem.layer))),
        ),
        Layer.provideMerge(BunHttpServer.layer({ port: 0, hostname: '127.0.0.1' })),
      )
    : ServerLive
const server = live.pipe(
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
