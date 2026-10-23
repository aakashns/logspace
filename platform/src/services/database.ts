// The SQLite database, through Effect SQL, and the migrations that make its tables.
//
// Migrations are the SQL files in db/migrations, embedded in the binary. Which have run is kept in
// the `data_table_migrations` table, in the same rows LogSpace 0.1 (the Remix version) wrote: the
// same ids, names, and SHA-256 checksums. So a database 0.1 made is upgraded in place, and 0.1 can
// still open one this made.
import * as path from 'node:path'
import { SqliteClient } from '@effect/sql-sqlite-bun'
import { Context, Effect, FileSystem, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import createPosts from '../../db/migrations/0001_create_posts.sql' with { type: 'text' }
import addArticleBody from '../../db/migrations/0002_add_article_body.sql' with { type: 'text' }
import createPostImages from '../../db/migrations/0003_create_post_images.sql' with { type: 'text' }
import createConfig from '../../db/migrations/0004_create_config.sql' with { type: 'text' }
import { AppConfig } from '../config.ts'

const MIGRATIONS = [
  { id: '0001', name: 'create_posts', sql: createPosts },
  { id: '0002', name: 'add_article_body', sql: addArticleBody },
  { id: '0003', name: 'create_post_images', sql: createPostImages },
  { id: '0004', name: 'create_config', sql: createConfig },
]

const JOURNAL = 'data_table_migrations'

// The connection, opened with foreign keys on and in WAL mode (Effect's default), so pages can be
// read while a post is being written.
export const DatabaseLive = Layer.unwrap(
  Effect.gen(function* () {
    let { databasePath } = yield* AppConfig
    // SQLite creates the file but not its folder.
    if (databasePath !== ':memory:') {
      yield* (yield* FileSystem.FileSystem).makeDirectory(path.dirname(databasePath), {
        recursive: true,
      })
    }
    return SqliteClient.layer({ filename: databasePath }).pipe(
      Layer.tap((context) =>
        Context.get(context, SqliteClient.SqliteClient).unsafe('PRAGMA foreign_keys = ON'),
      ),
    )
  }),
)

export class Migrations extends Context.Service<
  Migrations,
  {
    // Applies the migrations that haven't run yet (or with dryRun, only finds them), and returns
    // their names, like "0002_add_article_body".
    readonly run: (options?: { dryRun?: boolean }) => Effect.Effect<string[]>
  }
>()('logspace/Migrations') {
  static readonly layer = Layer.effect(
    Migrations,
    Effect.gen(function* () {
      let sql = yield* SqlClient.SqlClient

      let run = Effect.fn('Migrations.run')(function* ({ dryRun = false } = {}) {
        yield* sql.unsafe(
          `create table if not exists ${JOURNAL} (id varchar(64) not null primary key, ` +
            'name varchar(255) not null, checksum varchar(128) not null, ' +
            'batch integer not null, applied_at timestamp not null default current_timestamp)',
        )
        let applied = yield* sql<{
          id: string
          batch: number
        }>`select id, batch from ${sql(JOURNAL)}`
        let done = new Set(applied.map((row) => row.id))
        let pending = MIGRATIONS.filter((migration) => !done.has(migration.id))
        if (dryRun || pending.length === 0) return pending.map(fullName)

        let batch = Math.max(0, ...applied.map((row) => row.batch)) + 1
        // All of them or none.
        yield* Effect.forEach(pending, (migration) =>
          Effect.gen(function* () {
            for (let statement of splitStatements(migration.sql)) yield* sql.unsafe(statement)
            yield* sql`insert into ${sql(JOURNAL)} ${sql.insert({
              id: migration.id,
              name: migration.name,
              checksum: sha256(migration.sql),
              batch,
            })}`
          }),
        ).pipe(sql.withTransaction)
        return pending.map(fullName)
      }, Effect.orDie)

      return Migrations.of({ run })
    }),
  )
}

const fullName = (migration: { id: string; name: string }) => `${migration.id}_${migration.name}`

const sha256 = (text: string) => new Bun.CryptoHasher('sha256').update(text).digest('hex')

// A migration's statements, one by one, since SQLite prepares one statement at a time. The files
// have no semicolons in strings or comments to trip this up.
function splitStatements(sql: string): string[] {
  return sql
    .replace(/^\s*--.*$/gm, '')
    .split(/;\s*$/m)
    .map((statement) => statement.trim())
    .filter(Boolean)
}
