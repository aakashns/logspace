// Publishing, editing, and deleting posts: the write side for posts. Media storage and the
// database can't change together, so each command says what's left when one step fails.
import { Context, DateTime, Effect, Layer, Option, Schema, Semaphore } from 'effect'
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
import { DraftChanges } from '../services/draft-changes.ts'
import { MediaStorage, mediaKeys } from '../services/media-storage.ts'
import { PostNotFound, PostRejected } from './errors.ts'
import { makePostFiles } from './post-files.ts'

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
    // The commands that change the draft say so (see DraftChanges), with `by`, the composer
    // they were sent from.
    //
    // Publishes a post, and deletes its draft.
    readonly publish: (
      submission: PostSubmission,
      by?: string,
    ) => Effect.Effect<PostRecord, PostRejected>
    // Saves what's in the composer as the draft, so the composer can pick it up again, and says
    // whether it did: an empty composer isn't saved over nothing. There's one draft at a time, so
    // this replaces any other, and deletes its files unless its post is published. A published
    // post can't be saved as a draft.
    readonly saveDraft: (values: ComposeValues, by?: string) => Effect.Effect<boolean, PostRejected>
    // Saves files chosen in the composer as a new post's, before it's published, replacing any of
    // the same names, deletes the ones it no longer uses, and saves the draft (as saveDraft does,
    // and says so). A published post's files can't be changed this way.
    readonly updateFiles: (
      values: ComposeValues,
      uploads: PostSubmission['uploads'],
      unused: readonly string[],
      by?: string,
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
      let files = yield* makePostFiles()
      let storage = yield* MediaStorage
      let draftChanges = yield* DraftChanges
      // One owner, one shared draft: serialize all post mutations, including cleanup.
      let mutations = yield* Semaphore.make(1)
      let coordinated = <A, E, R>(work: Effect.Effect<A, E, R>) =>
        mutations.withPermit(Effect.uninterruptible(work))

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

      let alreadyPublished = new PostRejected({
        issues: [{ message: 'This post was already published.' }],
      })
      let publish = Effect.fn('PostCommands.publish')(function* (
        submission: PostSubmission,
        by?: string,
      ) {
        let { id } = submission.post
        if (Option.isSome(yield* findRecord(id))) {
          return yield* alreadyPublished
        }
        yield* activeDraft(id)
        return yield* Effect.gen(function* () {
          // An invalid id is one of the post's issues; no files are saved under it.
          if (isPostId(id)) yield* saveUploads(submission, id)
          let record = yield* check(submission)
          // Together, so a draft saved at the same time is either deleted or refused (see
          // writeDraft).
          let drafts = yield* Effect.gen(function* () {
            yield* sql`insert into posts ${sql.insert({ ...toPostRow(record) })}`
            return yield* sql`delete from drafts where id = ${id} returning id`
          }).pipe(
            sql.withTransaction,
            // A primary key clash (SQLite calls it a constraint error).
            Effect.catch((error) =>
              ['UniqueViolation', 'ConstraintError'].includes(error.reason._tag)
                ? Effect.fail(alreadyPublished)
                : Effect.die(error),
            ),
          )
          if (drafts.length > 0) yield* draftChanges.changed(by)
          return record
        })
      })

      // Called under the mutation lock, before any draft's files are changed.
      let unpublished = Effect.fnUntraced(function* (id: string) {
        if (!isPostId(id)) {
          return yield* new PostRejected({
            issues: [{ field: 'id', message: 'Expected a post id' }],
          })
        }
        if (Option.isSome(yield* findRecord(id))) {
          return yield* alreadyPublished
        }
        yield* activeDraft(id)
      })

      // ---- Drafts
      //
      // Two tabs can have the composer open, and share the draft: the last to save wins, and the
      // other follows (see DraftChanges). A tab that hasn't caught up, after its post was
      // discarded or replaced in another (whose files were deleted with it), could otherwise
      // bring back a draft whose media is gone, or upload files for a post nothing names any
      // more. Retired ids are refused, and every draft save checks its direct media references.
      let lostDraft = new PostRejected({
        issues: [
          {
            message:
              'This post was discarded or replaced in another tab, and its media deleted. Reload to pick up the current draft.',
          },
        ],
      })

      // Tombstones survive restarts and reject late uploads (including text-only drafts).
      let activeDraft = Effect.fnUntraced(function* (id: string) {
        let retired = yield* sql`select 1 from retired_drafts where id = ${id}`.pipe(Effect.orDie)
        if (retired.length > 0) return yield* lostDraft
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
        if (current.length === 0 && isEmptyComposer(values)) return false
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
      let writeDraft = Effect.fnUntraced(function* (values: ComposeValues, by?: string) {
        let { id } = values
        let data = yield* encodeDraft(values).pipe(Effect.orDie)
        let updated_at = DateTime.formatIso(yield* DateTime.now)
        let replaced = yield* Effect.gen(function* () {
          let published = yield* sql`select 1 from posts where id = ${id}`
          if (published.length > 0) return undefined
          let others = yield* sql<{ id: string }>`delete from drafts where id != ${id} returning id`
          for (let other of others) {
            yield* sql`insert or ignore into retired_drafts (id) values (${other.id})`
          }
          yield* sql`insert into drafts ${sql.insert({ id, data, updated_at })}
            on conflict (id) do update set data = excluded.data, updated_at = excluded.updated_at`
          return others.map((row) => row.id)
        }).pipe(sql.withTransaction, Effect.orDie)
        if (replaced === undefined) return yield* alreadyPublished
        yield* draftChanges.changed(by)
        for (let other of replaced) {
          if (Option.isSome(yield* findRecord(other))) continue
          yield* files.removeAll(other)
        }
      })

      let saveDraft = Effect.fn('PostCommands.saveDraft')(function* (
        values: ComposeValues,
        by?: string,
      ) {
        if (!(yield* draftable(values))) return false
        yield* writeDraft(values, by)
        return true
      })

      let updateFiles = Effect.fn('PostCommands.updateFiles')(function* (
        values: ComposeValues,
        uploads: PostSubmission['uploads'],
        unused: readonly string[],
        by?: string,
      ) {
        let { id } = values
        let save = yield* draftable(values, new Set(uploads.map((upload) => upload.name)))
        yield* Effect.forEach(uploads, ({ name, file }) => files.save(id, name, file), {
          discard: true,
        })
        if (save) yield* writeDraft(values, by)
        let used = new Set(composerFiles(values))
        yield* Effect.forEach(
          unused.filter((name) => !used.has(name)),
          (name) => files.remove(id, name),
          { discard: true },
        )
        return save
      })

      // Commit retirement first. Failed cleanup can leave unserved files, never a live draft
      // that names removed media, and a stale tab cannot resurrect the retired id.
      let discard = Effect.fn('PostCommands.discard')(function* (id: string) {
        yield* unpublished(id)
        let drafts = yield* Effect.gen(function* () {
          yield* sql`insert or ignore into retired_drafts (id) values (${id})`
          return yield* sql`delete from drafts where id = ${id} returning id`
        }).pipe(sql.withTransaction, Effect.orDie)
        if (drafts.length > 0) yield* draftChanges.changed()
        yield* files.removeAll(id)
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
        let deleted = yield* Effect.gen(function* () {
          let rows = yield* sql<{ id: string }>`delete from posts where id = ${id} returning id`
          if (rows.length > 0) yield* sql`insert or ignore into retired_drafts (id) values (${id})`
          return rows
        }).pipe(sql.withTransaction, Effect.orDie)
        if (deleted.length === 0) return yield* new PostNotFound({ id })
        yield* files.removeAll(id)
      })

      return PostCommands.of({
        publish: (...args) => coordinated(publish(...args)),
        saveDraft: (...args) => coordinated(saveDraft(...args)),
        updateFiles: (...args) => coordinated(updateFiles(...args)),
        discard: (...args) => coordinated(discard(...args)),
        edit: (...args) => coordinated(edit(...args)),
        delete: (...args) => coordinated(remove(...args)),
      })
    }),
  )
}
