// Writing a post's files: saving an upload, and removing every file of a deleted post. Each image
// saved gets a row in `post_images` with its upright size and a hash of it, which pages use to
// reserve its space and to version its URLs.
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Images } from '../lib/images.ts'
import { MediaStorage, mediaKeys } from '../lib/media-storage.ts'
import { isPostFileName, mimeType } from './post.ts'

// Captures the dependencies for these stateless operations; PostCommands owns the write lock.
export const makePostFiles = Effect.fn('makePostFiles')(function* () {
  let sql = yield* SqlClient.SqlClient
  let storage = yield* MediaStorage
  let images = yield* Images

  let removePrefix = (prefix: string) =>
    Effect.flatMap(storage.list(prefix), (files) =>
      Effect.forEach(files, (file) => storage.remove(file.key), { discard: true }),
    )

  // The name determines the served type, not the browser's claim. Replacing a file also replaces
  // its dimensions and version and invalidates its resized copies.
  let save = Effect.fn('postFiles.save')(function* (id: string, name: string, file: Blob) {
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

  let remove = Effect.fn('postFiles.remove')(function* (id: string, name: string) {
    if (!isPostFileName(name)) return yield* Effect.die(`Invalid post file name "${name}"`)
    yield* storage.remove(mediaKeys.postFile(id, name))
    yield* removePrefix(mediaKeys.variants(id, name))
    yield* sql`delete from post_images where post_id = ${id} and name = ${name}`.pipe(Effect.orDie)
  })

  let removeAll = Effect.fn('postFiles.removeAll')(function* (id: string) {
    yield* removePrefix(mediaKeys.postFiles(id))
    yield* removePrefix(mediaKeys.postVariants(id))
    yield* sql`delete from post_images where post_id = ${id}`.pipe(Effect.orDie)
  })
  return { save, remove, removeAll }
})
