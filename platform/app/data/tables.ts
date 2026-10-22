import { column as c, table } from 'remix/data-table'
import type { TableRow } from 'remix/data-table'

// Keep these in step with the SQL in db/migrations.

// How a post is stored is in posts/store.ts.
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
