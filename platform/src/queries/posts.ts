// Posts as pages read them: the read side for posts. Every read queries the database, and
// presents what it finds (media URLs, image sizes and versions, captions rendered to HTML).
import { Context, Effect, Layer, Result, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { ComposeValues } from '../domain/compose.ts'
import type { ImageInfo } from '../domain/images.ts'
import { findImageNames, findPosterCandidates, renderArticle } from '../domain/markdown.ts'
import { fromPostRow, POST_COLUMNS, type PostRow } from '../domain/post-rows.ts'
import { sortNewestFirst, type PostRecord } from '../domain/post.ts'
import { toPost, type ArticlePost, type Post } from '../domain/presentation.ts'
import { routes } from '../routes.ts'
import { MediaStorage, mediaKeys } from '../services/media-storage.ts'

const decodeDraft = Schema.decodeUnknownResult(Schema.fromJsonString(ComposeValues))

type ImageRow = ImageInfo & { readonly post_id: string; readonly name: string }

export class PostQueries extends Context.Service<
  PostQueries,
  {
    // Every post, newest first.
    readonly all: Effect.Effect<readonly Post[]>
    readonly find: (id: string) => Effect.Effect<Post | undefined>
    // A post as it's stored, for the edit form.
    readonly findRecord: (id: string) => Effect.Effect<PostRecord | undefined>
    // The size and version of one of a post's images, if it's one.
    readonly imageInfo: (id: string, name: string) => Effect.Effect<ImageInfo | undefined>
    // An article's body as HTML, its files served from /admin with `drafts` (for the composer).
    readonly articleHtml: (
      post: ArticlePost,
      options?: { drafts?: boolean },
    ) => Effect.Effect<string>
    // A post that may not be published yet, as the composer previews it: its files are served
    // from /admin, with their sizes and versions.
    readonly preview: (record: PostRecord) => Effect.Effect<Post>
    // The names and sizes of a post's files, from storage, for the /admin post form.
    readonly files: (id: string) => Effect.Effect<{ name: string; size: number }[]>
    // What was last in the composer, if a post is being written (see PostCommands.saveDraft).
    readonly draft: Effect.Effect<ComposeValues | undefined>
    // Recovery must distinguish a never-saved composer from a published or discarded one.
    readonly composerState: (id: string) => Effect.Effect<'active' | 'published' | 'retired'>
  }
>()('logspace/PostQueries') {
  static readonly layer = Layer.effect(
    PostQueries,
    Effect.gen(function* () {
      let sql = yield* SqlClient.SqlClient
      let storage = yield* MediaStorage

      let selectImages = (id?: string) =>
        sql<ImageRow>`select post_id, name, width, height, version from post_images ${
          id === undefined ? sql`` : sql`where post_id = ${id}`
        }`

      // Posts presented with their images' sizes and versions.
      let present = (rows: readonly PostRow[], imageRows: readonly ImageRow[]) => {
        let images = new Map(
          imageRows.map(({ post_id, name, width, height, version }) => [
            mediaKeys.postFile(post_id, name),
            { width, height, version },
          ]),
        )
        return rows.map((row) => {
          let record = fromPostRow(row)
          return toPost(record, (file) => images.get(mediaKeys.postFile(record.id, file)))
        })
      }

      let all = Effect.all(
        [sql<PostRow>`select ${sql.literal(POST_COLUMNS)} from posts`, selectImages()],
        { concurrency: 'unbounded' },
      ).pipe(
        Effect.map(([rows, imageRows]) => sortNewestFirst(present(rows, imageRows))),
        Effect.orDie,
        Effect.withSpan('PostQueries.all'),
      )

      let selectPost = (id: string) =>
        sql<PostRow>`select ${sql.literal(POST_COLUMNS)} from posts where id = ${id}`

      let find = Effect.fn('PostQueries.find')(function* (id: string) {
        let [rows, imageRows] = yield* Effect.all([selectPost(id), selectImages(id)], {
          concurrency: 'unbounded',
        }).pipe(Effect.orDie)
        return present(rows, imageRows)[0]
      })

      let findRecord = Effect.fn('PostQueries.findRecord')(function* (id: string) {
        let [row] = yield* Effect.orDie(selectPost(id))
        return row && fromPostRow(row)
      })

      let imageInfo = Effect.fn('PostQueries.imageInfo')(function* (id: string, name: string) {
        let [info] = yield* sql<ImageInfo>`
          select width, height, version from post_images where post_id = ${id} and name = ${name}
        `.pipe(Effect.orDie)
        return info
      })

      // The posters of an article's videos are found by name in storage (clip.mp4's is clip.jpg),
      // since they're named only by convention.
      let articleHtml = Effect.fn('PostQueries.articleHtml')(function* (
        post: ArticlePost,
        options?: { drafts?: boolean },
      ) {
        let { body } = post.article
        let candidates = findPosterCandidates(post.id, body)
        let [found, imageRows] = yield* Effect.all(
          [
            Effect.forEach(candidates, (name) => storage.has(mediaKeys.postFile(post.id, name)), {
              concurrency: 'unbounded',
            }),
            Effect.orDie(selectImages(post.id)),
          ],
          { concurrency: 'unbounded' },
        )
        let names = new Set(findImageNames(post.id, body))
        let images = new Map(
          imageRows
            .filter(({ name }) => names.has(name))
            .map(({ name, width, height, version }) => [name, { width, height, version }]),
        )
        return renderArticle(
          post.id,
          body,
          { posters: candidates.filter((_, i) => found[i]), images },
          options?.drafts ? routes.admin.postFile : routes.postFile,
        )
      })

      let preview = Effect.fn('PostQueries.preview')(function* (record: PostRecord) {
        let imageRows = yield* Effect.orDie(selectImages(record.id))
        let images = new Map(imageRows.map((row) => [row.name, row]))
        return toPost(record, (file) => images.get(file), routes.admin.postFile)
      })

      // A draft that doesn't decode (say, from an older version) is ignored, and the composer
      // starts afresh. Its files go once the new post's draft replaces it.
      let draft = Effect.gen(function* () {
        let [row] = yield* sql<{
          id: string
          data: string
        }>`select id, data from drafts order by updated_at desc limit 1`.pipe(Effect.orDie)
        if (!row) return undefined
        let decoded = decodeDraft(row.data)
        if (Result.isFailure(decoded)) {
          yield* Effect.logWarning(
            `Ignoring the draft of ${row.id}, which doesn't decode`,
            decoded.failure,
          )
          return undefined
        }
        // Its files are under the row's id.
        return { ...decoded.success, id: row.id }
      }).pipe(Effect.withSpan('PostQueries.draft'))

      return PostQueries.of({
        all,
        draft,
        find,
        findRecord,
        composerState: Effect.fn('PostQueries.composerState')(function* (id: string) {
          if (yield* findRecord(id)) return 'published'
          let retired = yield* sql`select 1 from retired_drafts where id = ${id}`.pipe(Effect.orDie)
          return retired.length > 0 ? 'retired' : 'active'
        }),
        imageInfo,
        articleHtml,
        preview,
        files: (id) =>
          Effect.map(storage.list(mediaKeys.postFiles(id)), (files) =>
            files
              .map((file) => ({
                name: file.key.slice(mediaKeys.postFiles(id).length),
                size: file.size,
              }))
              .toSorted((a, b) => a.name.localeCompare(b.name)),
          ),
      })
    }),
  )
}
