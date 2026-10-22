import { db } from '../db.ts'
import { getPostFileKey, getPostImages } from '../media.ts'
import { posts, type PostRow } from '../tables.ts'
import { getPostFileNames, parsePostRecords, sortNewestFirst, type PostRecord } from './model.ts'
import { toPost, type Post } from './presentation.ts'

// Posts in the database. A post's photos, video, or article is JSON in `details`, except that an
// article's body has its own column, `article_body`, for search.

// All posts, newest first, with their images' sizes and versions.
export async function getPosts(): Promise<Post[]> {
  return loadPosts(await db.findMany(posts))
}

export async function getPost(id: string): Promise<Post | undefined> {
  let row = await db.find(posts, id)
  return row ? (await loadPosts([row]))[0] : undefined
}

export async function getPostRecord(id: string): Promise<PostRecord | undefined> {
  let row = await db.find(posts, id)
  return row ? fromPostRows([row])[0] : undefined
}

// Rows are checked as they're read, though they were when they were written.
function fromPostRows(rows: PostRow[]): PostRecord[] {
  return parsePostRecords(
    rows.map(({ id, type, date, city, caption, details, article_body }) => {
      let post = { id, type, date, ...JSON.parse(details) }
      if (city !== null) post.city = city
      if (caption !== null) post.caption = caption
      if (article_body !== null) post.article = { ...post.article, body: article_body }
      return post
    }),
  )
}

// The columns that store a post (leaving the timestamps to the database).
export function toPostRow(post: PostRecord) {
  let { id, type, date, city = null, caption = null } = post
  let details = {}
  let article_body = null
  if (post.type === 'photos') details = { photos: post.photos }
  if (post.type === 'video') details = { video: post.video }
  if (post.type === 'article') {
    let { body, ...article } = post.article
    details = { article }
    article_body = body
  }
  return { id, type, date, city, caption, details: JSON.stringify(details), article_body }
}

async function loadPosts(rows: PostRow[]) {
  let records = fromPostRows(rows)
  let images = await getPostImages(
    records.flatMap((post) =>
      getPostFileNames(post).map((name): [string, string] => [post.id, name]),
    ),
  )
  return sortNewestFirst(
    records.map((post) => toPost(post, (file) => images.get(getPostFileKey(post.id, file)))),
  )
}
