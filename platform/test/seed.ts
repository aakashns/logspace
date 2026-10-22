import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLazyFile } from 'remix/fs'

import { saveSiteConfig, type SiteText } from '../app/data/config.ts'
import { db, migrateDatabase } from '../app/data/db.ts'
import { mediaStorage, savePostFile } from '../app/data/media.ts'
import { isPostFileName, isPostId, parsePostRecords } from '../app/data/posts/model.ts'
import { toPostRow } from '../app/data/posts/store.ts'
import { posts } from '../app/data/tables.ts'

// The sample posts the tests run on, one of each type, in test/content: posts.json has the posts
// (in the format of docs/posts.md) and posts/<id>/ each post's media files. An article's body is
// kept in article.md in its folder rather than in posts.json, since Markdown is easier to read in
// a file of its own than in a JSON string.
export const TEST_CONTENT_DIR = fileURLToPath(new URL('content/', import.meta.url))

// The site config the tests run with.
export const TEST_SITE_CONFIG: SiteText = {
  siteTitle: 'Test Site',
  siteUrl: 'https://example.com',
  siteDescription: 'Posts for testing.',
  heroHeading: 'Hi, I’m a test!',
  heroSubheading: 'I check that things work.',
  socialImageAlt: '',
}

// bun run test uses an in-memory database; this creates its tables, saves TEST_SITE_CONFIG, and
// replaces every post with the sample posts, so a beforeEach can run it to start each test afresh.
export async function seedDatabase() {
  await migrateDatabase()
  await saveSiteConfig(TEST_SITE_CONFIG)
  for (let { id } of await db.findMany(posts)) await db.delete(posts, id)
  await db.createMany(posts, (await readTestPosts()).map(toPostRow))
}

// Copies the sample posts' media files into media storage (memory storage under bun run test).
export async function seedMedia(storage = mediaStorage) {
  // Saving an image records its size in the database.
  await migrateDatabase()
  let postsDir = path.join(TEST_CONTENT_DIR, 'posts')
  for (let id of await fsp.readdir(postsDir)) {
    if (!isPostId(id)) continue
    for (let name of await fsp.readdir(path.join(postsDir, id))) {
      if (!isPostFileName(name) || name === 'article.md') continue
      await savePostFile(id, name, openLazyFile(path.join(postsDir, id, name)), storage)
    }
  }
}

// Throws, naming the post and field, if posts.json is invalid.
export async function readTestPosts() {
  let records = JSON.parse(await fsp.readFile(path.join(TEST_CONTENT_DIR, 'posts.json'), 'utf8'))
  return parsePostRecords(
    await Promise.all(
      records.map(async (record: Record<string, any>) => {
        if (record.type !== 'article' || 'body' in record.article) return record
        let file = path.join(TEST_CONTENT_DIR, 'posts', record.id, 'article.md')
        return { ...record, article: { ...record.article, body: await fsp.readFile(file, 'utf8') } }
      }),
    ),
  )
}
