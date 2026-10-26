// Posts as pages read them: the read side for posts. Every read queries the database, and
// presents what it finds (media URLs, image sizes and versions, captions rendered to HTML).
import { Context, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import type { ImageInfo } from '../../lib/image-widths.ts'
import { MediaStorage, mediaKeys } from '../../lib/media-storage.ts'
import { urls } from '../../lib/urls.ts'
import { isPostId, sortNewestFirst, type PostRecord } from './post.ts'
import { toPost, type Post } from './presentation.ts'
import { fromPostRow, POST_COLUMNS, type PostRow } from './rows.ts'

type ImageRow = ImageInfo & { readonly post_id: string; readonly name: string }

export class PostQueries extends Context.Service<
  PostQueries,
  {
    // Every post, newest first.
    readonly all: Effect.Effect<readonly Post[]>
    // A post, with its files at `fileUrl`: the site's own URLs, or full ones, for an email.
    readonly find: (
      id: string,
      fileUrl?: (id: string, file: string) => string,
    ) => Effect.Effect<Post | undefined>
    // A post as it's stored, for the composer to edit.
    readonly findRecord: (id: string) => Effect.Effect<PostRecord | undefined>
    // The size and version of one of a post's images, if it's one.
    readonly imageInfo: (id: string, name: string) => Effect.Effect<ImageInfo | undefined>
    // A post that may not be published yet, as the composer previews it: its files are served
    // from /admin, with their sizes and versions.
    readonly preview: (record: PostRecord) => Effect.Effect<Post>
    // The names of a post's files in media storage, published or not, so the composer gives a
    // new one a name of its own.
    readonly fileNames: (id: string) => Effect.Effect<string[]>
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
      let present = (
        rows: readonly PostRow[],
        imageRows: readonly ImageRow[],
        fileUrl = urls.postFile,
      ) => {
        let images = new Map(
          imageRows.map(({ post_id, name, width, height, version }) => [
            mediaKeys.postFile(post_id, name),
            { width, height, version },
          ]),
        )
        return rows.map((row) => {
          let record = fromPostRow(row)
          return toPost(record, (file) => images.get(mediaKeys.postFile(record.id, file)), fileUrl)
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

      let find = Effect.fn('PostQueries.find')(function* (
        id: string,
        fileUrl?: (id: string, file: string) => string,
      ) {
        let [rows, imageRows] = yield* Effect.all([selectPost(id), selectImages(id)], {
          concurrency: 'unbounded',
        }).pipe(Effect.orDie)
        return present(rows, imageRows, fileUrl)[0]
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

      let preview = Effect.fn('PostQueries.preview')(function* (record: PostRecord) {
        let imageRows = yield* Effect.orDie(selectImages(record.id))
        let images = new Map(imageRows.map((row) => [row.name, row]))
        return toPost(record, (file) => images.get(file), urls.admin.postFile)
      })

      return PostQueries.of({
        all,
        find,
        findRecord,
        imageInfo,
        preview,
        fileNames: (id) => {
          // Storage keys are built only from checked ids.
          if (!isPostId(id)) return Effect.succeed([])
          let folder = mediaKeys.postFiles(id)
          return Effect.map(storage.list(folder), (files) =>
            files.map((file) => file.key.slice(folder.length)),
          )
        },
      })
    }),
  )
}
