// The database: its migrations write the same journal as LogSpace 0.1 (the Remix version) did, so
// a database it made is upgraded in place.
import { describe, expect, it, spyOn } from 'bun:test'
import { Database } from 'bun:sqlite'
import { BunFileSystem } from '@effect/platform-bun'
import { Effect, Layer, Redacted, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { makeTestApp, TEST_CONFIG } from '../../test/app.ts'
import { AppConfig } from './config.ts'
import { DatabaseLive, runMigrations } from './database.ts'

const migrate = (databasePath: string, dryRun = false) =>
  Effect.runPromise(
    runMigrations({ dryRun }).pipe(
      Effect.provide(
        DatabaseLive.pipe(
          Layer.provide(BunFileSystem.layer),
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
  it('does not rerun schema initialization when the web handler joins the service runtime', async () => {
    let app = makeTestApp()
    try {
      await app.seedDatabase()
      let sql = await app.run(SqlClient.SqlClient)
      let statements = spyOn(sql, 'unsafe')
      try {
        expect((await app.fetch('/')).status).toBe(200)
        expect(
          statements.mock.calls.filter(([query]) => query.startsWith('create table')),
        ).toHaveLength(0)
      } finally {
        statements.mockRestore()
      }
    } finally {
      await app.dispose()
    }
  })

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
      '0005_rename_social_image_to_banner',
      '0006_create_drafts',
      '0007_protect_content_access',
      '0008_drop_drafts',
      '0009_dates_in_utc',
      '0010_drop_articles',
      '0011_create_users',
      '0012_create_push_subscriptions',
    ])
    expect(await migrate(file)).toHaveLength(12)
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
      {
        id: '0005',
        name: 'rename_social_image_to_banner',
        checksum: '825062aee1c7f6119ce0d1132a3ea6658f1446f3432343a40a783225dce81815',
        batch: 1,
      },
      {
        id: '0006',
        name: 'create_drafts',
        checksum: '6c1bf762e88c5d03c415e75f5388c4d48310786fd840b7b93e66ea5087d083d6',
        batch: 1,
      },
      {
        id: '0007',
        name: 'protect_content_access',
        checksum: 'da3da8e10a42777fb666717f31b980f1725f70b418846dfa34babe3512dffd22',
        batch: 1,
      },
      {
        id: '0008',
        name: 'drop_drafts',
        checksum: 'd8748ce01622d2672faaa9eeedd06a65441bfc0cc3ef916d5018cc4f3902de38',
        batch: 1,
      },
      {
        id: '0009',
        name: 'dates_in_utc',
        checksum: 'd60ff9c3822efe688868b9efe801c12e1ad924066c39779e633532afbe0ee419',
        batch: 1,
      },
      {
        id: '0010',
        name: 'drop_articles',
        checksum: 'd1362d6732d04f1a7f29a8abf5944669c4ee61b105741bae0251d3ccb2e1593f',
        batch: 1,
      },
      {
        id: '0011',
        name: 'create_users',
        checksum: 'b15a4cd63fae32ee4e76b87f3452bdee13498960d5625c2797d3009ec133f5ac',
        batch: 1,
      },
      {
        id: '0012',
        name: 'create_push_subscriptions',
        checksum: 'fa01ae69d701240075c312b69cc93eaec866bec0b346c2634a589058f1218a5e',
        batch: 1,
      },
    ])
    let columns = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ name: Schema.String })))(
      db.query("select name from pragma_table_info('posts')").all(),
    ).map((row) => row.name)
    expect(columns).not.toContain('article_body')
    expect(db.query("select name from sqlite_master where name like '%drafts'").all()).toEqual([])
    db.close()
  })

  it('renames a saved social preview image to the banner image', async () => {
    let file = `/tmp/logspace2-migrations-banner-${process.pid}.sqlite`
    for (let suffix of ['', '-wal', '-shm'])
      await Bun.file(file + suffix)
        .delete()
        .catch(() => {})
    await migrate(file)
    // A database from before 0005, with a social preview image saved.
    let db = new Database(file)
    db.run("delete from data_table_migrations where id = '0005'")
    let image = '{"file":"social.png","width":1200,"height":630,"version":"abc"}'
    db.run(
      "insert into config (key, value) values ('socialImage', ?), ('socialImageAlt', 'A card')",
      [image],
    )
    db.close()

    expect(await migrate(file)).toEqual(['0005_rename_social_image_to_banner'])
    db = new Database(file, { readonly: true })
    expect(db.query('select key, value from config order by key').all()).toEqual([
      { key: 'bannerImage', value: image },
      { key: 'bannerImageAlt', value: 'A card' },
    ])
    db.close()
  })

  it('converts post dates with a UTC offset to UTC', async () => {
    let file = `/tmp/logspace2-migrations-utc-${process.pid}.sqlite`
    for (let suffix of ['', '-wal', '-shm'])
      await Bun.file(file + suffix)
        .delete()
        .catch(() => {})
    await migrate(file)
    // A database from before 0009, with dates as local times and their offsets.
    let db = new Database(file)
    db.run("delete from data_table_migrations where id = '0009'")
    db.run(
      "insert into posts (id, type, date, caption) values ('offset0001', 'text', " +
        "'2026-10-16T18:42:00+05:30', 'Hi'), ('offset0002', 'text', '2026-10-16T18:42-07:00', " +
        "'Hi'), ('offset0003', 'text', '2026-10-16T18:42:05Z', 'Hi')",
    )
    db.close()

    expect(await migrate(file)).toEqual(['0009_dates_in_utc'])
    db = new Database(file, { readonly: true })
    expect(db.query('select id, date from posts order by id').all()).toEqual([
      { id: 'offset0001', date: '2026-10-16T13:12:00Z' },
      { id: 'offset0002', date: '2026-10-17T01:42:00Z' },
      { id: 'offset0003', date: '2026-10-16T18:42:05Z' },
    ])
    db.close()
  })
})
