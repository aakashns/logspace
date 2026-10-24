// Publishing, editing, and deleting posts: the write side for posts. Media storage and the
// database can't change together, so each command says what's left when one step fails.
import { Context, DateTime, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { fromPostRow, POST_COLUMNS, toPostRow, type PostRow } from '../domain/post-rows.ts'
import {
  getPostFileNames,
  isPostId,
  parsePostRecord,
  type PostIssue,
  type PostRecord,
} from '../domain/post.ts'
import { MediaStorage, mediaKeys } from '../services/media-storage.ts'
import { PostNotFound, PostRejected } from './errors.ts'
import { PostFiles } from './post-files.ts'

// A post as the /admin post form submitted it (see domain/post-form.ts).
export interface PostSubmission {
  // The post, unchecked.
  readonly post: { readonly id: string; readonly type: string; readonly [field: string]: unknown }
  // Files chosen with it, saved as the post's files under `name`, replacing any of the same names.
  readonly uploads: readonly { readonly name: string; readonly file: Blob }[]
  // Problems already found in the submission. One with any isn't saved, though its uploads are.
  readonly issues: readonly PostIssue[]
}

export class PostCommands extends Context.Service<
  PostCommands,
  {
    readonly publish: (submission: PostSubmission) => Effect.Effect<PostRecord, PostRejected>
    readonly edit: (
      id: string,
      submission: PostSubmission,
    ) => Effect.Effect<PostRecord, PostRejected | PostNotFound>
    readonly delete: (id: string) => Effect.Effect<void, PostNotFound>
  }
>()('logspace/PostCommands') {
  static readonly layer = Layer.effect(
    PostCommands,
    Effect.gen(function* () {
      let sql = yield* SqlClient.SqlClient
      let files = yield* PostFiles
      let storage = yield* MediaStorage

      let findRecord = (id: string) =>
        sql<PostRow>`select ${sql.literal(POST_COLUMNS)} from posts where id = ${id}`.pipe(
          Effect.orDie,
          Effect.map((rows) => Option.fromNullishOr(rows[0]).pipe(Option.map(fromPostRow))),
        )

      let saveUploads = ({ uploads }: PostSubmission, id: string) =>
        Effect.forEach(uploads, ({ name, file }) => files.save(id, name, file), { discard: true })

      // Checks the post, and that every file it names is in media storage.
      let check = Effect.fnUntraced(function* ({ post, issues }: PostSubmission) {
        let parsed = parsePostRecord(post)
        if (parsed._tag === 'Failure') {
          return yield* new PostRejected({ issues: [...issues, ...parsed.failure] })
        }
        let record = parsed.success
        let missing: PostIssue[] = []
        for (let file of getPostFileNames(record)) {
          if (yield* storage.has(mediaKeys.postFile(record.id, file))) continue
          missing.push({
            message: `${file} isn’t one of this post’s files. Choose the file to upload it, or check the name.`,
          })
        }
        let all = [...issues, ...missing]
        if (all.length > 0) return yield* new PostRejected({ issues: all })
        return record
      })

      // Uploads are saved before the post is checked, so a rejected submission doesn't need its
      // files chosen again. A new post's id can only be taken by a form submitted twice (every
      // new post form has a new id), and then nothing is saved, so its files can't replace the
      // published post's: a submission waits for any other of the same id to finish, and the
      // database refuses a second post with an id. If storing the post fails, its files stay
      // under its id, unserved, for the form to be submitted again.
      let alreadyPublished = new PostRejected({
        issues: [{ message: 'This post was already published.' }],
      })
      let publishing = new Set<string>()
      let publish = Effect.fn('PostCommands.publish')(function* (submission: PostSubmission) {
        let { id } = submission.post
        if (publishing.has(id) || Option.isSome(yield* findRecord(id))) {
          return yield* alreadyPublished
        }
        publishing.add(id)
        return yield* Effect.gen(function* () {
          // An invalid id is one of the post's issues; no files are saved under it.
          if (isPostId(id)) yield* saveUploads(submission, id)
          let record = yield* check(submission)
          yield* sql`insert into posts ${sql.insert({ ...toPostRow(record) })}`.pipe(
            // A primary key clash (SQLite calls it a constraint error).
            Effect.catch((error) =>
              ['UniqueViolation', 'ConstraintError'].includes(error.reason._tag)
                ? Effect.fail(alreadyPublished)
                : Effect.die(error),
            ),
          )
          return record
        }).pipe(Effect.ensuring(Effect.sync(() => publishing.delete(id))))
      })

      // A post's type can't change. Uploads replace the post's files of the same names right
      // away, even if the edit is rejected or storing it fails.
      let edit = Effect.fn('PostCommands.edit')(function* (id: string, submission: PostSubmission) {
        let existing = yield* findRecord(id)
        if (Option.isNone(existing)) return yield* new PostNotFound({ id })
        if (submission.post.type !== existing.value.type) {
          return yield* new PostRejected({
            issues: [{ field: 'type', message: 'A post’s type can’t change.' }],
          })
        }
        yield* saveUploads(submission, id)
        let record = yield* check({ ...submission, post: { ...submission.post, id } })
        let { id: _, ...row } = toPostRow(record)
        let updated_at = DateTime.formatIso(yield* DateTime.now)
        yield* sql`update posts set ${sql.update({ ...row, updated_at })} where id = ${id}`.pipe(
          Effect.orDie,
        )
        return record
      })

      // The post goes first: if removing its files fails, the files left over aren't served,
      // while a post whose files went first would show broken media.
      let remove = Effect.fn('PostCommands.delete')(function* (id: string) {
        let deleted = yield* sql<{
          id: string
        }>`delete from posts where id = ${id} returning id`.pipe(Effect.orDie)
        if (deleted.length === 0) return yield* new PostNotFound({ id })
        yield* files.removeAll(id)
      })

      return PostCommands.of({ publish, edit, delete: remove })
    }),
  )
}
