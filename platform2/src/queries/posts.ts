// Posts as pages read them: the read side for posts.
//
// The read model is every post, presented (media URLs, image sizes and versions, captions rendered
// to HTML) and sorted newest first, built with two queries and kept in memory until the data
// changes (see services/data-version.ts). The home page, a post's page, the feeds, and the media
// route all read it, so serving a page doesn't touch the database. An article's body is rendered
// the first time it's read, and kept with the read model.
import { Context, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import type { ImageInfo } from '../domain/images.ts'
import { findImageNames, findPosterCandidates, renderArticle } from '../domain/markdown.ts'
import { fromPostRow, POST_COLUMNS, type PostRow } from '../domain/post-rows.ts'
import { sortNewestFirst, type PostRecord } from '../domain/post.ts'
import { toPost, type ArticlePost, type Post } from '../domain/presentation.ts'
import { makeView } from '../services/data-version.ts'
import { MediaStorage, mediaKeys } from '../services/media-storage.ts'

interface ReadModel {
  // Newest first.
  readonly posts: readonly Post[]
  readonly byId: ReadonlyMap<string, { readonly post: Post; readonly record: PostRecord }>
  // The size and version of every saved image of every post, by storage key (see mediaKeys).
  readonly images: ReadonlyMap<string, ImageInfo>
  // Articles' bodies as HTML, by post id, filled in as they're read.
  readonly articles: Map<string, string>
}

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
    // An article's body as HTML.
    readonly articleHtml: (post: ArticlePost) => Effect.Effect<string>
    // The names and sizes of a post's files, from storage, for the /admin post form.
    readonly files: (id: string) => Effect.Effect<{ name: string; size: number }[]>
  }
>()('logspace/PostQueries') {
  static readonly layer = Layer.effect(
    PostQueries,
    Effect.gen(function* () {
      let sql = yield* SqlClient.SqlClient
      let storage = yield* MediaStorage

      let readModel = yield* makeView(
        Effect.gen(function* () {
          let [rows, imageRows] = yield* Effect.all(
            [
              sql<PostRow>`select ${sql.literal(POST_COLUMNS)} from posts`,
              sql<
                ImageInfo & { post_id: string; name: string }
              >`select post_id, name, width, height, version from post_images`,
            ],
            { concurrency: 'unbounded' },
          )
          let images = new Map(
            imageRows.map(({ post_id, name, width, height, version }) => [
              mediaKeys.postFile(post_id, name),
              { width, height, version },
            ]),
          )
          let byId = new Map<string, { post: Post; record: PostRecord }>()
          for (let row of rows) {
            let record = fromPostRow(row)
            let post = toPost(record, (file) => images.get(mediaKeys.postFile(record.id, file)))
            byId.set(record.id, { post, record })
          }
          let posts = sortNewestFirst([...byId.values()].map((entry) => entry.post))
          return { posts, byId, images, articles: new Map() } satisfies ReadModel
        }).pipe(Effect.orDie, Effect.withSpan('PostQueries.build')),
      )

      // The posters of an article's videos are found by name in storage (clip.mp4's is clip.jpg),
      // since they're named only by convention. Storage only changes through commands, which
      // change the data version, so the body is rendered once per read model.
      let articleHtml = Effect.fn('PostQueries.articleHtml')(function* (post: ArticlePost) {
        let model = yield* readModel
        let cached = model.articles.get(post.id)
        if (cached !== undefined) return cached
        let { body } = post.article
        let candidates = findPosterCandidates(post.id, body)
        let found = yield* Effect.forEach(
          candidates,
          (name) => storage.has(mediaKeys.postFile(post.id, name)),
          { concurrency: 'unbounded' },
        )
        let images = new Map<string, ImageInfo>()
        for (let name of findImageNames(post.id, body)) {
          let info = model.images.get(mediaKeys.postFile(post.id, name))
          if (info) images.set(name, info)
        }
        let html = renderArticle(post.id, body, {
          posters: candidates.filter((_, i) => found[i]),
          images,
        })
        model.articles.set(post.id, html)
        return html
      })

      return PostQueries.of({
        all: Effect.map(readModel, (model) => model.posts),
        find: (id) => Effect.map(readModel, (model) => model.byId.get(id)?.post),
        findRecord: (id) => Effect.map(readModel, (model) => model.byId.get(id)?.record),
        imageInfo: (id, name) =>
          Effect.map(readModel, (model) => model.images.get(mediaKeys.postFile(id, name))),
        articleHtml,
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
