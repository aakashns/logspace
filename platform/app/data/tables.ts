import { column as c, table } from 'remix/data-table'
import type { TableRow } from 'remix/data-table'

// Keep these in step with the SQL in db/migrations.

// A post's photos, video, or article is JSON in `details`, in the format of docs/posts.md, except
// that an article's body has its own column, `article_body`. A row turns back into a post record
// with toPostRecord.
export const posts = table({
  name: 'posts',
  columns: {
    id: c.text(),
    type: c.text(),
    date: c.text(),
    city: c.text().nullable(),
    caption: c.text().nullable(),
    details: c.text(),
    article_body: c.text().nullable(),
    created_at: c.text(),
    updated_at: c.text(),
  },
})

export type PostRow = TableRow<typeof posts>

// The size and content hash of each of a post's images (see media.ts).
export const postImages = table({
  name: 'post_images',
  columns: {
    post_id: c.text(),
    name: c.text(),
    width: c.integer(),
    height: c.integer(),
    version: c.text(),
  },
  primaryKey: ['post_id', 'name'],
})

// The site's configuration, one row per saved setting (see config.ts).
export const config = table({
  name: 'config',
  columns: {
    key: c.text(),
    value: c.text(),
  },
  primaryKey: ['key'],
})

const BASE_FIELDS = ['id', 'type', 'date', 'city', 'caption']

type Article = Record<string, unknown> & { body?: unknown }

// The post record a row stores, for parsePosts to validate.
export function toPostRecord(row: PostRow): Record<string, unknown> {
  let { id, type, date, city, caption, details, article_body } = row
  let record: Record<string, unknown> = { id, type, date, ...JSON.parse(details) }
  if (city !== null) record.city = city
  if (caption !== null) record.caption = caption
  if (article_body !== null) record.article = { ...(record.article as Article), body: article_body }
  return record
}

// The columns that store a post record (leaving the timestamps to the database).
export function fromPostRecord(record: Record<string, unknown>) {
  let details = Object.fromEntries(
    Object.entries(record).filter(([key]) => !BASE_FIELDS.includes(key)),
  )
  // An article's body goes in its own column.
  let { body, ...article } = (details.article ?? {}) as Article
  if (details.article) details.article = article
  return {
    id: String(record.id),
    type: String(record.type),
    date: String(record.date),
    city: typeof record.city === 'string' ? record.city : null,
    caption: typeof record.caption === 'string' ? record.caption : null,
    details: JSON.stringify(details),
    article_body: typeof body === 'string' ? body : null,
  }
}
