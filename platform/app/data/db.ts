import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSqliteDatabase } from 'remix/data-table/sqlite'
import { loadMigrations } from 'remix/data-table/migrations/node'

// The SQLite database file. Without DATABASE_PATH it's db/app.sqlite, inside the repo, which
// `git clean -x` would delete, so set DATABASE_PATH to keep it outside: production uses
// /var/lib/logspace/app.sqlite (see scripts/logspace.service). ":memory:" gives a throwaway
// database, as the tests use.
const isInMemory = process.env.DATABASE_PATH === ':memory:'

export const DATABASE_PATH = isInMemory
  ? ':memory:'
  : path.resolve(
      process.env.DATABASE_PATH ?? fileURLToPath(new URL('../../db/app.sqlite', import.meta.url)),
    )

const MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations/', import.meta.url))

// SQLite creates the file but not its folder.
if (!isInMemory) fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true })

export const db = createSqliteDatabase({
  filename: DATABASE_PATH,
  foreignKeys: true,
})

// Applies any migrations in db/migrations that haven't run yet. The server runs this before it
// starts listening.
export async function migrateDatabase() {
  await db.migrate(await loadMigrations(MIGRATIONS_DIR))
}
