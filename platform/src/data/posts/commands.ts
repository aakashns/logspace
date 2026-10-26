// Saving and deleting posts: the write side for posts. Media storage and the database can't
// change together, so each command says what's left when one step fails. A new post is emailed
// to everyone subscribed.
import { Context, DateTime, Effect, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { MediaStorage, mediaKeys } from '../../lib/media-storage.ts'
import { urls } from '../../lib/urls.ts'
import { Email, type EmailMessage } from '../site/email.ts'
import { configuredSite, SiteConfigQueries } from '../site/queries.ts'
import type { SiteConfig } from '../site/site.ts'
import { allUsers } from '../users/queries.ts'
import { makePostFiles } from './files.ts'
import {
  getPostFileNames,
  isPostId,
  parsePostRecord,
  type PostIssue,
  type PostRecord,
} from './post.ts'
import type { Post } from './presentation.ts'
import { PostQueries } from './queries.ts'
import { fromPostRow, POST_COLUMNS, toPostRow, type PostRow } from './rows.ts'

// What these commands can refuse to do. These are expected: the composer shows why.

// The post wasn't saved, for these reasons.
export class PostRejected extends Schema.TaggedError<PostRejected>()('PostRejected', {
  issues: Schema.Array(
    Schema.Struct({ field: Schema.optionalKey(Schema.String), message: Schema.String }),
  ),
}) {}

export class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
  id: Schema.String,
}) {}

// A post as the composer submitted it (see ../../routes/admin/compose/form.ts).
export interface PostSubmission {
  // The post, unchecked.
  readonly post: { readonly id: string; readonly type: string; readonly [field: string]: unknown }
  // Files chosen with it, saved as the post's files under `name`, replacing any of the same names.
  readonly uploads: readonly { readonly name: string; readonly file: Blob }[]
  // Problems already found in the submission. One with any isn't saved, though its uploads are.
  readonly issues: readonly PostIssue[]
}

// The email telling subscribers about a new post, with its files' full URLs, which the composer
// makes (see ../../routes/admin/compose/email.tsx).
export type NewPostEmail = (post: Post, site: SiteConfig) => Omit<EmailMessage, 'to'>

export class PostCommands extends Context.Service<
  PostCommands,
  {
    // Publishes the post, or saves it over the published one with its id. A new one is emailed
    // to everyone subscribed, as `email` makes it, in the background.
    readonly save: (
      submission: PostSubmission,
      email: NewPostEmail,
    ) => Effect.Effect<PostRecord, PostRejected>
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
      let queries = yield* PostQueries
      let siteConfig = yield* SiteConfigQueries
      let mail = yield* Email
      // Where emails are sent from, which outlives the request that published the post.
      let scope = yield* Effect.scope

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

      // Emails post `id` to each subscriber, one after another. An address that can't be sent to
      // is skipped; once nothing can be (email isn't set up, or the hour's emails are sent), the
      // rest aren't sent.
      let announce = Effect.fnUntraced(
        function* (id: string, email: NewPostEmail) {
          let users = yield* allUsers
          if (users.length === 0) return
          let site = yield* configuredSite
          let post = yield* queries.find(id, (id, file) => site.siteUrl + urls.postFile(id, file))
          if (!post) return
          let message = email(post, site)
          yield* Effect.forEach(
            users,
            (user) =>
              mail
                .send({ ...message, to: user.email })
                .pipe(Effect.catchTag(['EmailAddressInvalid', 'EmailNotSent'], () => Effect.void)),
            { discard: true },
          )
        },
        (effect) =>
          effect.pipe(
            Effect.catchCause((cause) => Effect.logWarning('New post not emailed to all', cause)),
            Effect.provideService(SqlClient.SqlClient, sql),
            Effect.provideService(SiteConfigQueries, siteConfig),
          ),
      )

      // Uploads are saved before the post is checked, so a rejected submission doesn't need its
      // files chosen again. Once the post is stored, the files it doesn't name go. If storing the
      // post fails, its files are left as they were; if removing them fails, they're left,
      // unserved.
      let save = Effect.fn('PostCommands.save')(function* (
        submission: PostSubmission,
        email: NewPostEmail,
      ) {
        let { id } = submission.post
        // An invalid id is one of the post's issues; no files are saved under it.
        if (isPostId(id)) yield* saveUploads(id, submission.uploads)
        let record = yield* check(submission)
        let { id: _, ...row } = toPostRow(record)
        let updated_at = DateTime.formatIso(yield* DateTime.now)
        // Whether it's new, in the transaction that saves it, so a form posted twice emails once.
        let isNew = yield* Effect.gen(function* () {
          let existing = yield* sql`select id from posts where id = ${id}`
          yield* sql`insert into posts ${sql.insert({ id, ...row })}
            on conflict (id) do update set ${sql.update({ ...row, updated_at })}`
          return existing.length === 0
        }).pipe(sql.withTransaction, Effect.orDie)
        yield* cleanUp(id)
        if (isNew) yield* Effect.forkIn(announce(id, email), scope)
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
