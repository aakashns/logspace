// `logspace migrate [--dry-run]`: applies the database migrations that haven't run yet, as the
// server does when it starts, or with --dry-run, lists them. It's the database `start` would use:
// DATABASE_PATH, else on a server `logspace setup` set up, the service's, else data/app.sqlite.
import * as fs from 'node:fs'
import { Console, Effect, Layer } from 'effect'

import { AppConfig } from '../config.ts'
import { DatabaseLive, Migrations } from '../services/database.ts'
import { DOMAINS_FILE, SERVER_DATABASE_PATH } from './setup.ts'
import { fail } from './shell.ts'

export const migrate = Effect.fn('migrate')(function* (dryRun: boolean) {
  if (!process.env.DATABASE_PATH && fs.existsSync(DOMAINS_FILE)) {
    process.env.DATABASE_PATH = SERVER_DATABASE_PATH
  }
  let config = yield* Effect.provide(AppConfig, AppConfig.layer)
  let file = config.databasePath
  // A dry run doesn't make a database that isn't there.
  if (dryRun && file !== ':memory:' && !fs.existsSync(file)) {
    return yield* fail(`There's no database at ${file}`)
  }
  let names = yield* Effect.flatMap(Migrations, (migrations) => migrations.run({ dryRun })).pipe(
    Effect.provide(
      Migrations.layer.pipe(
        Layer.provide(DatabaseLive),
        Layer.provide(Layer.succeed(AppConfig, config)),
      ),
    ),
  )
  if (names.length === 0) return yield* Console.log(`${file} has no migrations to apply`)
  yield* Console.log(`${dryRun ? 'To apply' : 'Applied'} to ${file}:`)
  for (let name of names) yield* Console.log(`  ${name}`)
})
