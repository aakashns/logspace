// The app, for the tests: an in-memory database and media storage, driven through its web
// handler, as a browser would drive the server. Each test file makes its own, so they don't share
// data.
import { BunFileSystem } from '@effect/platform-bun'
import { Clock, Effect, Layer, ManagedRuntime, Redacted } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'

import { AppRoutes, AppServices, ROUTER_CONFIG } from '../src/server.ts'
import { AppConfig } from '../src/config.ts'
import { PublicNetwork } from '../src/services/public-http.ts'
import { seedDatabase, seedMedia } from './seed.ts'

export const ADMIN_PASSWORD = 'test-password-1234'

export const TEST_CONFIG = AppConfig.of({
  port: 0,
  hostname: '127.0.0.1',
  mode: 'test',
  trustProxy: false,
  databasePath: ':memory:',
  mediaStorage: 'memory',
  mediaDir: '/nonexistent',
  cacheDir: '/tmp/logspace2-test-cache',
  adminPassword: Redacted.make(ADMIN_PASSWORD),
  sessionSecret: Redacted.make('test-session-secret'),
})

export type TestApp = ReturnType<typeof makeTestApp>

export function makeTestApp(
  config: Partial<AppConfig['Service']> = {},
  overrides: { clock?: Clock.Clock; network?: PublicNetwork['Service'] } = {},
) {
  let configLayer = Layer.succeed(AppConfig, AppConfig.of({ ...TEST_CONFIG, ...config }))
  // The runtime (for calling services directly) and the handler share one MemoMap, so they share
  // every service, and so the database.
  let memoMap = Layer.makeMemoMapUnsafe()
  let services = Layer.mergeAll(AppServices, BunFileSystem.layer).pipe(
    Layer.provide(
      overrides.network ? Layer.succeed(PublicNetwork, overrides.network) : PublicNetwork.layer,
    ),
    Layer.provide(configLayer),
    Layer.provide(overrides.clock ? Layer.succeed(Clock.Clock, overrides.clock) : Layer.empty),
  )
  let runtime = ManagedRuntime.make(services, { memoMap })
  let { handler, dispose } = HttpRouter.toWebHandler(
    AppRoutes.pipe(
      Layer.provideMerge(services),
      Layer.provide(configLayer),
      Layer.provide(HttpServer.layerServices),
    ),
    { memoMap, disableLogger: true, routerConfig: ROUTER_CONFIG },
  )

  let app = {
    fetch: (path: string, init?: RequestInit) =>
      handler(new Request(new URL(path, 'http://localhost'), init)),
    run: <A, E>(
      effect: Effect.Effect<A, E, ManagedRuntime.ManagedRuntime.Services<typeof runtime>>,
    ) => runtime.runPromise(effect),
    // Replaces the site's config and every post with the test content's.
    seedDatabase: () => runtime.runPromise(seedDatabase),
    // Copies the test content's media into storage.
    seedMedia: () => runtime.runPromise(seedMedia),
    logIn: (password = ADMIN_PASSWORD, headers: HeadersInit = {}) =>
      app.fetch('/admin/login', {
        method: 'POST',
        headers,
        body: new URLSearchParams({ password }),
      }),
    // The `name=value` part of the session cookie a response sets, to send back on later requests.
    sessionCookie: (response: Response) =>
      response.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith('admin_session='))
        ?.split(';')[0],
    // A request with a new admin session.
    adminFetch: async (path: string, init?: RequestInit) => {
      let cookie = defined(app.sessionCookie(await app.logIn()), 'a session cookie')
      return app.fetch(path, { ...init, headers: { Cookie: cookie, ...init?.headers } })
    },
    dispose: async () => {
      await dispose()
      await runtime.dispose()
    },
  }
  return app
}

// A value the test needs, which fails it if it's missing.
export function defined<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${what}`)
  return value
}

// What the first group of `pattern` matches in `text`, which fails the test if it doesn't match.
export function capture(text: string, pattern: RegExp): string {
  let group = pattern.exec(text)?.[1]
  if (group === undefined) throw new Error(`Expected ${pattern} to match`)
  return group
}
