// The app, for the tests: an in-memory database and media storage, driven through its web
// handler, as a browser would drive the server. Each test file makes its own, so they don't share
// data.
import { Effect, Layer, ManagedRuntime, Redacted } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'

import { AppRoutes, AppServices, ROUTER_CONFIG } from '../src/app.ts'
import { AppConfig } from '../src/config.ts'
import { seedDatabase, seedMedia } from './seed.ts'

export const ADMIN_PASSWORD = 'test-password-1234'

export const TEST_CONFIG = AppConfig.of({
  port: 0,
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

export function makeTestApp(config: Partial<AppConfig['Service']> = {}) {
  let configLayer = Layer.succeed(AppConfig, AppConfig.of({ ...TEST_CONFIG, ...config }))
  // The runtime (for calling services directly) and the handler share one MemoMap, so they share
  // every service, and so the database.
  let memoMap = Layer.makeMemoMapUnsafe()
  let services = AppServices.pipe(Layer.provide(configLayer))
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
    logIn: (password = ADMIN_PASSWORD, headers?: HeadersInit) =>
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
      let cookie = app.sessionCookie(await app.logIn())!
      return app.fetch(path, { ...init, headers: { Cookie: cookie, ...init?.headers } })
    },
    dispose: async () => {
      await dispose()
      await runtime.dispose()
    },
  }
  return app
}
