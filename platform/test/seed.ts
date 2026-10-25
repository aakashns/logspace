// The sample posts the tests run on, in test/content: posts.json has the posts and posts/<id>/
// each post's media files.
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { makePostFiles } from '../src/data/posts/files.ts'
import { isPostFileName, isPostId, PostRecord } from '../src/data/posts/post.ts'
import { toPostRow } from '../src/data/posts/rows.ts'
import { SiteConfigCommands } from '../src/data/site/commands.ts'
import type { SiteText } from '../src/data/site/site.ts'
import testPosts from './content/posts.json'

export const TEST_CONTENT_DIR = path.join(import.meta.dir, 'content')

// The site config the tests run with.
export const TEST_SITE_CONFIG: SiteText = {
  siteTitle: 'Test Site',
  siteUrl: 'https://example.com',
  siteDescription: 'Posts for testing.',
  heroHeading: 'Hi, I’m a test!',
  heroSubheading: 'I check that things work.',
  bannerImageAlt: '',
}

// Saves TEST_SITE_CONFIG and replaces every post with the sample posts, so a beforeEach
// can run it to start each test afresh.
export const seedDatabase = Effect.gen(function* () {
  let sql = yield* SqlClient.SqlClient
  yield* (yield* SiteConfigCommands).save(TEST_SITE_CONFIG)
  let rows = Schema.decodeUnknownSync(Schema.Array(PostRecord))(testPosts).map(toPostRow)
  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`delete from posts`
      yield* sql`delete from admin_sessions`
      yield* sql`delete from verifications`
      yield* sql`delete from users`
      yield* sql`insert into posts ${sql.insert(rows.map((row) => ({ ...row })))}`
    }),
  )
}).pipe(Effect.orDie)

// Copies the sample posts' media files into media storage.
export const seedMedia = Effect.gen(function* () {
  let files = yield* makePostFiles()
  let postsDir = path.join(TEST_CONTENT_DIR, 'posts')
  for (let id of yield* Effect.promise(() => fs.readdir(postsDir))) {
    if (!isPostId(id)) continue
    for (let name of yield* Effect.promise(() => fs.readdir(path.join(postsDir, id)))) {
      if (!isPostFileName(name)) continue
      yield* files.save(id, name, Bun.file(path.join(postsDir, id, name)))
    }
  }
})
