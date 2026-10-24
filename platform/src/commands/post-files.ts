// Writing a post's files: saving an upload, and removing every file of a deleted post. Each image
// saved gets a row in `post_images` with its upright size and a hash of it, which pages use to
// reserve its space and to version its URLs.
import { Context, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { isPostFileName, mimeType } from '../domain/post.ts'
import { Images } from '../services/images.ts'
import { MediaStorage, mediaKeys } from '../services/media-storage.ts'

export class PostFiles extends Context.Service<
  PostFiles,
  {
    // Stores a file of a post, replacing any it had by that name, with its resized copies and
    // info. Its type is its name's (see mimeType), not what the browser claimed, since the type
    // is what it's served as.
    readonly save: (id: string, name: string, file: Blob) => Effect.Effect<void>
    // Removes one of a post's files, with its resized copies and info.
    readonly remove: (id: string, name: string) => Effect.Effect<void>
    // Removes all of a post's files, with their resized copies and info.
    readonly removeAll: (id: string) => Effect.Effect<void>
  }
>()('logspace/PostFiles') {
  static readonly layer = Layer.effect(
    PostFiles,
    Effect.gen(function* () {
      let sql = yield* SqlClient.SqlClient
      let storage = yield* MediaStorage
      let images = yield* Images

      let removePrefix = (prefix: string) =>
        Effect.flatMap(storage.list(prefix), (files) =>
          Effect.forEach(files, (file) => storage.remove(file.key), { discard: true }),
        )

      let save = Effect.fn('PostFiles.save')(function* (id: string, name: string, file: Blob) {
        if (!isPostFileName(name)) return yield* Effect.die(`Invalid post file name "${name}"`)
        yield* storage.put(mediaKeys.postFile(id, name), file)
        // The old file's resized copies and info go with it.
        yield* removePrefix(mediaKeys.variants(id, name))
        let info = mimeType(name)?.startsWith('image/')
          ? yield* images.readInfo(new Uint8Array(yield* Effect.promise(() => file.arrayBuffer())))
          : undefined
        yield* sql
          .withTransaction(
            Effect.gen(function* () {
              yield* sql`delete from post_images where post_id = ${id} and name = ${name}`
              if (info) {
                yield* sql`insert into post_images ${sql.insert({ post_id: id, name, ...info })}`
              }
            }),
          )
          .pipe(Effect.orDie)
      })

      let remove = Effect.fn('PostFiles.remove')(function* (id: string, name: string) {
        if (!isPostFileName(name)) return yield* Effect.die(`Invalid post file name "${name}"`)
        yield* storage.remove(mediaKeys.postFile(id, name))
        yield* removePrefix(mediaKeys.variants(id, name))
        yield* sql`delete from post_images where post_id = ${id} and name = ${name}`.pipe(
          Effect.orDie,
        )
      })

      let removeAll = Effect.fn('PostFiles.removeAll')(function* (id: string) {
        yield* removePrefix(mediaKeys.postFiles(id))
        yield* removePrefix(mediaKeys.postVariants(id))
        yield* sql`delete from post_images where post_id = ${id}`.pipe(Effect.orDie)
      })

      return PostFiles.of({ save, remove, removeAll })
    }),
  )
}
