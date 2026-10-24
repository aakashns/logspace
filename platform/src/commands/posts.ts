// Saving and deleting posts: the write side for posts. Media storage and the database can't
// change together, so each command says what's left when one step fails.
import { Context, DateTime, Effect, Layer } from 'effect'
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
import { makePostFiles } from './post-files.ts'

// A post as the composer submitted it (see domain/compose.ts).
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
    // Publishes the post, or saves it over the published one with its id.
    readonly save: (submission: PostSubmission) => Effect.Effect<PostRecord, PostRejected>
    // Saves files chosen in the composer as the post's, before it's saved.
    readonly upload: (
      id: string,
      uploads: PostSubmission['uploads'],
    ) => Effect.Effect<void, PostRejected>
    // Throws away what the composer uploaded for a post it was closed without saving: all of a
    // new post's files, or the ones an edit added.
    readonly discard: (id: string) => Effect.Effect<void>
    readonly delete: (id: string) => Effect.Effect<void, PostNotFound>
  }
>()('logspace/PostCommands') {
  static readonly layer = Layer.effect(
    PostCommands,
    Effect.gen(function* () {
      let sql = yield* SqlClient.SqlClient
      let files = yield* makePostFiles()
      let storage = yield* MediaStorage

      let saveUploads = (id: string, uploads: PostSubmission['uploads']) =>
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

      // Removes post `id`'s files that it doesn't name, with their resized copies: files taken
      // out in the composer, an edit's old media, or all of a post never saved.
      let cleanUp = Effect.fnUntraced(function* (id: string) {
        if (!isPostId(id)) return
        let rows =
          yield* sql<PostRow>`select ${sql.literal(POST_COLUMNS)} from posts where id = ${id}`.pipe(
            Effect.orDie,
          )
        let named = rows[0] ? getPostFileNames(fromPostRow(rows[0])) : []
        let folder = mediaKeys.postFiles(id)
        yield* Effect.forEach(
          (yield* storage.list(folder))
            .map((file) => file.key.slice(folder.length))
            .filter((name) => !named.includes(name)),
          (name) => files.remove(id, name),
          { discard: true },
        )
      })

      // Uploads are saved before the post is checked, so a rejected submission doesn't need its
      // files chosen again. Once the post is stored, the files it doesn't name go. If storing the
      // post fails, its files are left as they were; if removing them fails, they're left,
      // unserved.
      let save = Effect.fn('PostCommands.save')(function* (submission: PostSubmission) {
        let { id } = submission.post
        // An invalid id is one of the post's issues; no files are saved under it.
        if (isPostId(id)) yield* saveUploads(id, submission.uploads)
        let record = yield* check(submission)
        let { id: _, ...row } = toPostRow(record)
        let updated_at = DateTime.formatIso(yield* DateTime.now)
        yield* sql`insert into posts ${sql.insert({ id, ...row })}
          on conflict (id) do update set ${sql.update({ ...row, updated_at })}`.pipe(Effect.orDie)
        yield* cleanUp(id)
        return record
      })

      let upload = Effect.fn('PostCommands.upload')(function* (
        id: string,
        uploads: PostSubmission['uploads'],
      ) {
        if (!isPostId(id)) {
          return yield* new PostRejected({
            issues: [{ field: 'id', message: 'Expected a post id' }],
          })
        }
        yield* saveUploads(id, uploads)
      })

      let discard = Effect.fn('PostCommands.discard')(cleanUp)

      // The post goes first: if removing its files fails, the files left over aren't served,
      // while a post whose files went first would show broken media.
      let remove = Effect.fn('PostCommands.delete')(function* (id: string) {
        let deleted = yield* sql<{
          id: string
        }>`delete from posts where id = ${id} returning id`.pipe(Effect.orDie)
        if (deleted.length === 0) return yield* new PostNotFound({ id })
        yield* files.removeAll(id)
      })

      return PostCommands.of({ save, upload, discard, delete: remove })
    }),
  )
}
