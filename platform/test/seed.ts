import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLazyFile } from 'remix/fs'

import { saveSiteConfig, type SiteText } from '../app/data/config.ts'
import { db, migrateDatabase } from '../app/data/db.ts'
import { isPostFileName, mediaStorage, savePostFile } from '../app/data/media.ts'
import { isPostId, parsePosts } from '../app/data/posts.ts'
import { fromPostRecord, posts } from '../app/data/tables.ts'

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

// bun run test uses an in-memory database; this creates its tables, saves TEST_SITE_CONFIG, and adds
// the sample posts that aren't there yet, so a test file's beforeAll can run it for each of its
// suites.
export async function seedDatabase() {
  await migrateDatabase()
  await saveSiteConfig(TEST_SITE_CONFIG)
  let records = await readTestPostRecords()
  // Throws, naming the post and field, if posts.json is invalid.
  parsePosts(records)
  let existing = new Set((await db.findMany(posts)).map((row) => row.id))
  let added = records.filter((record) => !existing.has(String(record.id)))
  if (added.length > 0) await db.createMany(posts, added.map(fromPostRecord))
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

export async function readTestPosts() {
  return parsePosts(await readTestPostRecords())
}

async function readTestPostRecords(): Promise<Record<string, unknown>[]> {
  let records = JSON.parse(await fsp.readFile(path.join(TEST_CONTENT_DIR, 'posts.json'), 'utf8'))
  return Promise.all(
    records.map(async (record: Record<string, any>) => {
      if (record.type !== 'article' || 'body' in record.article) return record
      let file = path.join(TEST_CONTENT_DIR, 'posts', record.id, 'article.md')
      return { ...record, article: { ...record.article, body: await fsp.readFile(file, 'utf8') } }
    }),
  )
}
