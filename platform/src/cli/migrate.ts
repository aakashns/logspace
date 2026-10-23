// `logspace migrate [--dry-run]`: applies the database migrations that haven't run yet, as the
// server does when it starts, or with --dry-run, lists them. It's the database `start` would use:
// DATABASE_PATH, else on a server `logspace setup` set up, the service's, else data/app.sqlite.
import { Config, Console, Effect, FileSystem, Layer, Option } from 'effect'

import { AppConfig } from '../config.ts'
import { DatabaseLive, Migrations } from '../services/database.ts'
import { DOMAINS_FILE, SERVER_DATABASE_PATH } from './setup.ts'
import { fail, reportFailures } from './shell.ts'

export const migrate = Effect.fn('migrate')(function* (dryRun: boolean) {
  let fs = yield* FileSystem.FileSystem
  let config = yield* Effect.provide(AppConfig, AppConfig.layer)
  let databasePathSet = Option.isSome(yield* Config.option(Config.String('DATABASE_PATH')))
  let onServer = !databasePathSet && (yield* fs.exists(DOMAINS_FILE))
  let file = onServer ? SERVER_DATABASE_PATH : config.databasePath
  // A dry run doesn't make a database that isn't there.
  if (dryRun && file !== ':memory:' && !(yield* fs.exists(file))) {
    return yield* fail(`There's no database at ${file}`)
  }
  let names = yield* Effect.flatMap(Migrations, (migrations) => migrations.run({ dryRun })).pipe(
    Effect.provide(
      Migrations.layer.pipe(
        Layer.provide(DatabaseLive),
        Layer.provide(Layer.succeed(AppConfig, { ...config, databasePath: file })),
      ),
    ),
    Effect.catchTag('SqlError', (error) =>
      Effect.fail(fail(`Couldn't migrate ${file}: ${error.message}`)),
    ),
  )
  if (names.length === 0) return yield* Console.log(`${file} has no migrations to apply`)
  yield* Console.log(`${dryRun ? 'To apply' : 'Applied'} to ${file}:`)
  for (let name of names) yield* Console.log(`  ${name}`)
}, reportFailures)
