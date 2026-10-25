// `logspace migrate [--dry-run]`: applies the database migrations that haven't run yet, as the
// server does when it starts, or with --dry-run, lists them, in the database `start` would use
// (see database.ts).
import { Console, Effect } from 'effect'

import { runMigrations } from '../lib/database.ts'
import { commandDatabase } from './database.ts'
import { fail, reportFailures } from './shell.ts'

export const migrate = Effect.fn('migrate')(function* (dryRun: boolean) {
  let { file, exists, layer } = yield* commandDatabase
  // A dry run doesn't make a database that isn't there.
  if (dryRun && !exists) return yield* fail(`There's no database at ${file}`)
  let names = yield* runMigrations({ dryRun }).pipe(
    Effect.provide(layer),
    Effect.catchTag('SqlError', (error) =>
      Effect.fail(fail(`Couldn't migrate ${file}: ${error.message}`)),
    ),
  )
  if (names.length === 0) return yield* Console.log(`${file} has no migrations to apply`)
  yield* Console.log(`${dryRun ? 'To apply' : 'Applied'} to ${file}:`)
  for (let name of names) yield* Console.log(`  ${name}`)
}, reportFailures)
