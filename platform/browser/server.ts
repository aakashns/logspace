// The real application and bundled assets, with explicit disposable configuration. This entry
// point never reads AppConfig.layer or .env. All app data stays in the test-owned directory.
import { BunRuntime } from '@effect/platform-bun'
import { Context, Effect, Layer, Redacted } from 'effect'
import { HttpServer } from 'effect/http'
import { join } from 'node:path'

import { AppConfig } from '../src/config.ts'
import { ServerLive } from '../src/server.ts'

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

const server = ServerLive.pipe(
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
