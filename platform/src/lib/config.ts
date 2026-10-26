// The server's settings, from environment variables. Everything that differs between a laptop, a
// server, and the tests is here, so the rest of the app reads it from this service rather than
// from process.env.
import * as path from 'node:path'
import { Config, Context, Effect, Layer, Redacted } from 'effect'

// How long ADMIN_PASSWORD and AUTH_SESSION_SECRET must be: /admin, and what's keyed off the
// secret (like push notifications', see ../data/push/delivery.ts), is off until they are.
export const MIN_SECRET_LENGTH = 16

export class AppConfig extends Context.Service<
  AppConfig,
  {
    readonly port: number
    // Keep the existing wildcard listener for custom deployments; deploy sets loopback explicitly.
    readonly hostname: string
    // 'production' serves pages for real; 'development' runs `bun run dev`; 'test' runs the tests
    // (which mustn't reach out to the network).
    readonly mode: 'production' | 'development' | 'test'
    // Set behind a reverse proxy that overwrites the Forwarded and X-Forwarded-* headers (Caddy),
    // so the URL the browser used is rebuilt from them (see http/forwarded.ts).
    readonly trustProxy: boolean
    // The SQLite database file, or ":memory:" for a throwaway one.
    readonly databasePath: string
    // Where uploaded media (posts' files, and the site's logo and icon) is kept: a folder,
    // MEDIA_DIR, or with MEDIA_STORAGE=memory, memory, as the tests use. (S3 isn't supported yet.)
    readonly mediaStorage: 'fs' | 'memory'
    readonly mediaDir: string
    // Where caches are kept: link previews, which are fetched again if it's deleted.
    readonly cacheDir: string
    // /admin's password, and the secret that signs its session cookie. /admin is switched off
    // until both are at least 16 characters (see http/admin-session.ts).
    readonly adminPassword: Redacted.Redacted<string>
    readonly sessionSecret: Redacted.Redacted<string>
  }
>()('logspace/AppConfig') {
  // Without DATABASE_PATH, MEDIA_DIR, and CACHE_DIR, data goes in data/ in the working directory.
  static readonly layer = Layer.effect(
    AppConfig,
    Effect.gen(function* () {
      // The binary is production unless NODE_ENV says otherwise; a checkout is development.
      let mode = yield* Config.Literals(['production', 'development', 'test'], 'NODE_ENV').pipe(
        Config.withDefault(
          Bun.isStandaloneExecutable ? ('production' as const) : ('development' as const),
        ),
      )
      // fs (the default, files in MEDIA_DIR) or memory.
      let mediaStorage = Config.Literals(['fs', 'memory'], 'MEDIA_STORAGE').pipe(
        Config.withDefault('fs'),
      )
      let resolve = (name: string, fallback: string) =>
        Config.String(name).pipe(
          Config.withDefault(fallback),
          Config.map((value) => (value === ':memory:' ? value : path.resolve(value))),
        )
      return AppConfig.of({
        port: yield* Config.Port('PORT').pipe(Config.withDefault(44100)),
        hostname: yield* Config.String('HOST').pipe(Config.withDefault('::')),
        mode,
        trustProxy: (yield* Config.String('TRUST_PROXY').pipe(Config.withDefault(''))) === '1',
        databasePath: yield* resolve('DATABASE_PATH', 'data/app.sqlite'),
        mediaStorage: yield* mediaStorage,
        mediaDir: yield* resolve('MEDIA_DIR', 'data/media'),
        cacheDir: yield* resolve('CACHE_DIR', 'data/cache'),
        adminPassword: yield* Config.Redacted('ADMIN_PASSWORD').pipe(
          Config.withDefault(Redacted.make('')),
        ),
        sessionSecret: yield* Config.Redacted('AUTH_SESSION_SECRET').pipe(
          Config.withDefault(Redacted.make('')),
        ),
      })
    }),
  )
}
