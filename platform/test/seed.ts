// The sample posts the tests run on, one of each type, in test/content: posts.json has the posts
// and posts/<id>/ each post's media files. An article's body is kept in article.md in its folder
// rather than in posts.json, since Markdown is easier to read in a file of its own.
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect, Predicate, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { makePostFiles } from '../src/commands/post-files.ts'
import { SiteConfigCommands } from '../src/commands/site-config.ts'
import { toPostRow } from '../src/domain/post-rows.ts'
import { isPostFileName, isPostId, parsePostRecord, type PostRecord } from '../src/domain/post.ts'
import type { SiteText } from '../src/domain/site.ts'

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
  let rows = (yield* Effect.promise(readTestPosts)).map(toPostRow)
  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`delete from posts`
      yield* sql`delete from admin_sessions`
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
      if (!isPostFileName(name) || name === 'article.md') continue
      yield* files.save(id, name, Bun.file(path.join(postsDir, id, name)))
    }
  }
})

// posts.json: posts, each with an id and a type, checked by parsePostRecord once their article
// bodies are read in.
const decodeTestPosts = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.StructWithRest(Schema.Struct({ id: Schema.String, type: Schema.String }), [
      Schema.Record(Schema.String, Schema.Unknown),
    ]),
  ),
)

// Throws, naming the post and field, if posts.json is invalid.
export async function readTestPosts(): Promise<PostRecord[]> {
  let records = decodeTestPosts(await Bun.file(path.join(TEST_CONTENT_DIR, 'posts.json')).json())
  return Promise.all(
    records.map(async (record) => {
      let { id, type, article } = record
      if (type === 'article' && Predicate.isObject(article) && !('body' in article)) {
        let file = path.join(TEST_CONTENT_DIR, 'posts', id, 'article.md')
        record = { ...record, article: { ...article, body: await Bun.file(file).text() } }
      }
      let result = parsePostRecord(record)
      if (result._tag === 'Failure')
        throw new Error(`Invalid test post ${id}: ${JSON.stringify(result.failure)}`)
      return result.success
    }),
  )
}
