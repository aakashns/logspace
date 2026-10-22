// `logspace migrate [--dry-run]`: applies the database migrations that haven't run yet, as the
// server does when it starts, or with --dry-run, lists them. It's the database `start` would use:
// DATABASE_PATH, else on a server `logspace setup` set up, the service's, else data/app.sqlite.
import * as fs from 'node:fs'
import * as path from 'node:path'

import { CommandError } from './command.ts'
import { DOMAINS_FILE, SERVER_DATABASE_PATH } from './setup.ts'

export async function migrate(args: string[]): Promise<void> {
  let dryRun = false
  for (let arg of args) {
    if (arg === '--dry-run') dryRun = true
    else throw new CommandError(`Unexpected argument: ${arg}`)
  }
  process.env.DATABASE_PATH ??= fs.existsSync(DOMAINS_FILE)
    ? SERVER_DATABASE_PATH
    : path.resolve('data/app.sqlite')
  let file = process.env.DATABASE_PATH
  // A dry run doesn't make a database that isn't there.
  if (dryRun && file !== ':memory:' && !fs.existsSync(file)) {
    throw new CommandError(`There's no database at ${file}`)
  }

  let { db, migrateDatabase } = await import('../app/data/db.ts')
  try {
    let names = await migrateDatabase({ dryRun })
    if (names.length === 0) {
      console.log(`${file} has no migrations to apply`)
      return
    }
    console.log(`${dryRun ? 'To apply' : 'Applied'} to ${file}:`)
    for (let name of names) console.log(`  ${name}`)
  } finally {
    await db.close()
  }
}
