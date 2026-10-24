// How a post is stored in the `posts` table (see db/migrations). The fields every post has get
// their own columns; its photos or video is JSON in `details`.
import { Result, Schema } from 'effect'

import { parsePostRecord, type PostRecord } from './post.ts'

export interface PostRow {
  readonly id: string
  readonly type: string
  readonly date: string
  readonly city: string | null
  readonly caption: string | null
  readonly details: string
}

// The columns that store a post (the timestamps are left to the database).
export function toPostRow(post: PostRecord): PostRow {
  let { id, type, date, city = null, caption = null } = post
  let details = {}
  if (post.type === 'photos') details = { photos: post.photos }
  if (post.type === 'video') details = { video: post.video }
  return { id, type, date, city, caption, details: JSON.stringify(details) }
}

// A stored post. Rows are checked as they're read, though they were when they were written, and
// one that's wrong (edited by hand) throws an error naming the post and field.
export function fromPostRow({ id, type, date, city, caption, details }: PostRow): PostRecord {
  let parsed = decodeDetails(details).pipe(
    Result.mapError(() => [{ field: 'details', message: 'Expected a JSON object' }]),
    Result.flatMap((stored) =>
      parsePostRecord({
        id,
        type,
        date,
        ...stored,
        ...(city !== null && { city }),
        ...(caption !== null && { caption }),
      }),
    ),
  )
  if (Result.isSuccess(parsed)) return parsed.success
  let issues = parsed.failure.map(
    (issue) => `  ${[`post "${id}"`, issue.field].filter(Boolean).join(', ')}: ${issue.message}`,
  )
  throw new Error(`Invalid posts:\n${issues.join('\n')}`)
}

const decodeDetails = Schema.decodeUnknownResult(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
)

export const POST_COLUMNS = 'id, type, date, city, caption, details'
