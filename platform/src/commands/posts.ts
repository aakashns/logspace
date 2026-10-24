// Publishing, editing, and deleting posts: the write side for posts. Media storage and the
// database can't change together, so each command says what's left when one step fails.
import { Context, DateTime, Effect, Layer, Option, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { composerFiles, ComposeValues, isEmptyComposer } from '../domain/compose.ts'
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

const encodeDraft = Schema.encodeEffect(Schema.fromJsonString(ComposeValues))

export class PostCommands extends Context.Service<
  PostCommands,
  {
    // Publishes a post, and deletes its draft.
    readonly publish: (submission: PostSubmission) => Effect.Effect<PostRecord, PostRejected>
    // Saves what's in the composer as the draft, so the composer can pick it up again, and says
    // whether it did: an empty composer isn't saved over nothing. There's one draft at a time, so
    // this replaces any other, and deletes its files unless its post is published. A published
    // post can't be saved as a draft.
    readonly saveDraft: (values: ComposeValues) => Effect.Effect<boolean, PostRejected>
    // Saves files chosen in the composer as a new post's, before it's published, replacing any of
    // the same names, deletes the ones it no longer uses, and saves the draft (as saveDraft does,
    // and says so). A published post's files can't be changed this way.
    readonly updateFiles: (
      values: ComposeValues,
      uploads: PostSubmission['uploads'],
      unused: readonly string[],
    ) => Effect.Effect<boolean, PostRejected>
    // Deletes a post discarded in the composer, before it was published: its files and its draft.
    readonly discard: (id: string) => Effect.Effect<void, PostRejected>
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
          // Together, so a draft saved at the same time is either deleted or refused (see
          // writeDraft).
          yield* Effect.gen(function* () {
            yield* sql`insert into posts ${sql.insert({ ...toPostRow(record) })}`
            yield* sql`delete from drafts where id = ${id}`
          }).pipe(
            sql.withTransaction,
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

      // A new post's id, if it's one that isn't published or being published.
      let unpublished = Effect.fnUntraced(function* (id: string) {
        if (!isPostId(id)) {
          return yield* new PostRejected({
            issues: [{ field: 'id', message: 'Expected a post id' }],
          })
        }
        if (publishing.has(id) || Option.isSome(yield* findRecord(id))) {
          return yield* alreadyPublished
        }
      })

      // ---- Drafts
      //
      // Two tabs can have the composer open, and share the draft: the last to save wins. A tab
      // left open after its post was discarded or replaced in another (whose files were deleted
      // with it) could otherwise bring back a draft whose media is gone, or upload files for a
      // post nothing names any more. So a post that isn't the draft can become it only if its
      // files are all there.
      let lostDraft = new PostRejected({
        issues: [
          {
            message:
              'This post was discarded or replaced in another tab, and its media deleted. Reload to pick up the current draft.',
          },
        ],
      })

      // Whether the composer's values can be saved as the draft, checked before any of their
      // files are saved: false when there's nothing to save. `uploading` names the files about to
      // be saved.
      let draftable = Effect.fnUntraced(function* (
        values: ComposeValues,
        uploading: ReadonlySet<string> = new Set(),
      ) {
        yield* unpublished(values.id)
        let current = yield* sql`select 1 from drafts where id = ${values.id}`.pipe(Effect.orDie)
        if (current.length > 0) return true
        if (isEmptyComposer(values)) return false
        for (let file of composerFiles(values)) {
          if (uploading.has(file)) continue
          if (!(yield* storage.has(mediaKeys.postFile(values.id, file)))) return yield* lostDraft
        }
        return true
      })

      // The post is checked for again with the write, in one transaction, as publishing inserts
      // the post and deletes its draft in one: so a preview sent just before the post was
      // published can't bring it back as a draft. If removing a replaced draft's files fails,
      // they're left under its id.
      let writeDraft = Effect.fnUntraced(function* (values: ComposeValues) {
        let { id } = values
        let data = yield* encodeDraft(values).pipe(Effect.orDie)
        let updated_at = DateTime.formatIso(yield* DateTime.now)
        let replaced = yield* Effect.gen(function* () {
          let published = yield* sql`select 1 from posts where id = ${id}`
          if (published.length > 0) return undefined
          let others = yield* sql<{ id: string }>`delete from drafts where id != ${id} returning id`
          yield* sql`insert into drafts ${sql.insert({ id, data, updated_at })}
            on conflict (id) do update set data = excluded.data, updated_at = excluded.updated_at`
          return others.map((row) => row.id)
        }).pipe(sql.withTransaction, Effect.orDie)
        if (replaced === undefined) return yield* alreadyPublished
        for (let other of replaced) {
          if (publishing.has(other) || Option.isSome(yield* findRecord(other))) continue
          yield* files.removeAll(other)
        }
      })

      let saveDraft = Effect.fn('PostCommands.saveDraft')(function* (values: ComposeValues) {
        if (!(yield* draftable(values))) return false
        yield* writeDraft(values)
        return true
      })

      let updateFiles = Effect.fn('PostCommands.updateFiles')(function* (
        values: ComposeValues,
        uploads: PostSubmission['uploads'],
        unused: readonly string[],
      ) {
        let { id } = values
        let save = yield* draftable(values, new Set(uploads.map((upload) => upload.name)))
        yield* Effect.forEach(uploads, ({ name, file }) => files.save(id, name, file), {
          discard: true,
        })
        yield* Effect.forEach(unused, (name) => files.remove(id, name), { discard: true })
        if (save) yield* writeDraft(values)
        return save
      })

      // The files go first: if removing them fails, the draft is still there to discard again.
      let discard = Effect.fn('PostCommands.discard')(function* (id: string) {
        yield* unpublished(id)
        yield* files.removeAll(id)
        yield* sql`delete from drafts where id = ${id}`.pipe(Effect.orDie)
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

      return PostCommands.of({
        publish,
        saveDraft,
        updateFiles,
        discard,
        edit,
        delete: remove,
      })
    }),
  )
}
