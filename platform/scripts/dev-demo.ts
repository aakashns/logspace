// `bun run dev:demo`: a site to try the app on with nothing to set up. It makes a temporary folder
// for the database and media, fills it with the sample posts the tests use, picks a free port and
// a new admin password, and runs `bun run dev`'s server on them, restarting on change. Nothing is
// read from .env or the environment, so it never touches a real site's data, and the folder is
// deleted when the server stops (Ctrl-C). Its email is set up to send to the site's fake of Amazon
// SES (its endpoint, with AWS's example key), which shows what it took at /dev/emails.
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect, Layer, Redacted } from 'effect'

import { SiteConfigCommands } from '../src/data/site/commands.ts'
import { AppConfig } from '../src/lib/config.ts'
import { EXAMPLE_AWS_KEY } from '../src/routes/dev/emails/handler.tsx'
import { urls } from '../src/lib/urls.ts'
import { AppLive } from '../src/server.ts'
import { seedDatabase, seedMedia, TEST_SITE_CONFIG } from '../test/seed.ts'

const root = path.join(import.meta.dir, '..')
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'logspace-demo-'))
const password = crypto.randomUUID()
const secret = crypto.randomUUID()

// The port the OS hands out for a moment's listener is free to use. (Other dev servers use
// 44100 and up, so a fixed one could clash.)
const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() })
const port = probe.port
await probe.stop()
if (port === undefined) throw new Error('No free port')
const origin = `http://127.0.0.1:${port}`

const config = {
  databasePath: path.join(directory, 'app.sqlite'),
  mediaDir: path.join(directory, 'media'),
  cacheDir: path.join(directory, 'cache'),
}

const seeding = Effect.runPromise(
  Effect.gen(function* () {
    yield* seedMedia
    yield* seedDatabase
    // So share buttons and feeds link to this server rather than the tests' example.com.
    yield* (yield* SiteConfigCommands).save({ ...TEST_SITE_CONFIG, siteUrl: origin })
    yield* (yield* SiteConfigCommands).saveEmail({
      provider: 'ses',
      fromName: TEST_SITE_CONFIG.siteTitle,
      from: 'demo@example.com',
      replyTo: 'demo-replies@example.com',
      sesRegion: 'us-east-1',
      sesEndpoint: new URL(urls.dev.ses(), origin).href,
      sesAccessKeyId: EXAMPLE_AWS_KEY.accessKeyId,
      sesSecretAccessKey: EXAMPLE_AWS_KEY.secretAccessKey,
      resendApiKey: '',
    })
  }).pipe(
    Effect.provide(
      AppLive.pipe(
        Layer.provide(
          Layer.succeed(
            AppConfig,
            AppConfig.of({
              ...config,
              port,
              hostname: '127.0.0.1',
              mode: 'development',
              trustProxy: false,
              mediaStorage: 'fs',
              adminPassword: Redacted.make(password),
              sessionSecret: Redacted.make(secret),
            }),
          ),
        ),
      ),
    ),
  ),
)
await seeding.catch(async (error: unknown) => {
  await fs.rm(directory, { recursive: true, force: true })
  throw error
})

console.log(`
  LogSpace demo   ${origin}
  Admin           ${origin}/admin
  Password        ${password}
  Data            ${directory} (deleted when this stops)
  Email sent      ${origin}/dev/emails
`)

const server = Bun.spawn(['bun', '--no-env-file', '--watch', 'src/cli/index.ts', 'start'], {
  cwd: root,
  // Only what's set here, so a developer's .env, proxy, or real data paths can't leak in.
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: String(port),
    DATABASE_PATH: config.databasePath,
    MEDIA_DIR: config.mediaDir,
    CACHE_DIR: config.cacheDir,
    ADMIN_PASSWORD: password,
    AUTH_SESSION_SECRET: secret,
  },
  stdio: ['ignore', 'inherit', 'inherit'],
})
// Ctrl-C reaches the server too; this waits for it to stop, then deletes the folder.
let stopped = false
for (let signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopped = true
    server.kill(signal)
  })
}
const code = await server.exited
await fs.rm(directory, { recursive: true, force: true })
process.exit(stopped ? 0 : code)
