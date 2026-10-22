import * as assert from 'remix/assert'
import { sql } from 'remix/data-table'
import { loadMigrations } from 'remix/data-table/migrations/node'
import { createSqliteDatabase } from 'remix/data-table/sqlite'
import { describe, it } from 'remix/test'

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url).pathname

describe('migrations', () => {
  it('0002 moves article bodies out of details into article_body, and back', async () => {
    let db = createSqliteDatabase({ filename: ':memory:' })
    let migrations = await loadMigrations(MIGRATIONS_DIR)
    await db.migrate(migrations, { to: '0001_create_posts' })
    let article = { title: 'T', summary: 'S', body: '# Body' }
    await db.exec(sql`
      insert into posts (id, type, date, details)
      values
        ('aaaaaaaaaa', 'article', '2026-10-01T09:00:00Z', ${JSON.stringify({ article })}),
        ('bbbbbbbbbb', 'text', '2026-10-01T09:00:00Z', '{}')
    `)
    let rows = async () =>
      (await db.exec(sql`select * from posts order by id`)).rows as Record<string, unknown>[]

    await db.migrate(migrations, { to: '0002_add_article_body' })
    let [migratedArticle, text] = await rows()
    assert.equal(migratedArticle.article_body, '# Body')
    assert.deepEqual(JSON.parse(String(migratedArticle.details)), {
      article: { title: 'T', summary: 'S' },
    })
    assert.equal(text.article_body, null)

    await db.migrate(migrations, { direction: 'down', step: 1 })
    let [restored] = await rows()
    assert.equal(restored.article_body, undefined)
    assert.deepEqual(JSON.parse(String(restored.details)), { article })
    await db.close()
  })
})
