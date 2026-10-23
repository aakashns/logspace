// The database: its migrations write the same journal as LogSpace 0.1 (the Remix version) did, so
// a database it made is upgraded in place.
import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { Effect, Layer, Redacted } from 'effect'

import { AppConfig } from '../src/config.ts'
import { DatabaseLive, Migrations } from '../src/services/database.ts'
import { TEST_CONFIG } from './app.ts'

const migrate = (databasePath: string, dryRun = false) =>
  Effect.runPromise(
    Effect.flatMap(Migrations, (migrations) => migrations.run({ dryRun })).pipe(
      Effect.provide(
        Migrations.layer.pipe(
          Layer.provide(DatabaseLive),
          Layer.provide(
            Layer.succeed(
              AppConfig,
              AppConfig.of({ ...TEST_CONFIG, databasePath, adminPassword: Redacted.make('') }),
            ),
          ),
        ),
      ),
    ),
  )

describe('migrations', () => {
  it('journals each migration as LogSpace 0.1 did, with the same checksums', async () => {
    let file = `/tmp/logspace2-migrations-${process.pid}.sqlite`
    for (let suffix of ['', '-wal', '-shm'])
      await Bun.file(file + suffix)
        .delete()
        .catch(() => {})
    expect(await migrate(file, true)).toEqual([
      '0001_create_posts',
      '0002_add_article_body',
      '0003_create_post_images',
      '0004_create_config',
    ])
    expect(await migrate(file)).toHaveLength(4)
    expect(await migrate(file)).toEqual([])

    let db = new Database(file, { readonly: true })
    expect(
      db.query('select id, name, checksum, batch from data_table_migrations order by id').all(),
    ).toEqual([
      {
        id: '0001',
        name: 'create_posts',
        checksum: 'bbfded2dc939845a66f51007a7a5b09ffc1afcac16a54f70cb3f43dd17585ff2',
        batch: 1,
      },
      {
        id: '0002',
        name: 'add_article_body',
        checksum: '7efc2651fcb82d7dc1e4231a2a041940147997bf4889297394cc2361ea9cbeda',
        batch: 1,
      },
      {
        id: '0003',
        name: 'create_post_images',
        checksum: '6ebc084dda86b5984e4f9f51b0fd978eb8036feb90005403f09de662d57519d4',
        batch: 1,
      },
      {
        id: '0004',
        name: 'create_config',
        checksum: '12033da6287771f56fc3d4cd7fda53432f76fc8a600beff69739d529ae558a13',
        batch: 1,
      },
    ])
    let columns = db
      .query("select name from pragma_table_info('posts')")
      .all()
      .map((row: any) => row.name)
    expect(columns).toContain('article_body')
    db.close()
  })
})
