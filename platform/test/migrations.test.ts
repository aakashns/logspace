// The database: its migrations write the same journal as LogSpace 0.1 (the Remix version) did, so
// a database it made is upgraded in place.
import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { BunFileSystem } from '@effect/platform-bun'
import { Effect, Layer, Redacted, Schema } from 'effect'

import { AppConfig } from '../src/config.ts'
import { DatabaseLive, Migrations } from '../src/services/database.ts'
import { TEST_CONFIG } from './app.ts'

const migrate = (databasePath: string, dryRun = false) =>
  Effect.runPromise(
    Effect.flatMap(Migrations, (migrations) => migrations.run({ dryRun })).pipe(
      Effect.provide(
        Migrations.layer.pipe(
          Layer.provide(DatabaseLive),
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
    ])
    expect(await migrate(file)).toHaveLength(6)
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
    ])
    let columns = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ name: Schema.String })))(
      db.query("select name from pragma_table_info('posts')").all(),
    ).map((row) => row.name)
    expect(columns).toContain('article_body')
    expect(db.query("select name from pragma_table_info('drafts')").all()).toEqual([
      { name: 'id' },
      { name: 'data' },
      { name: 'updated_at' },
    ])
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
})
