// A post's files as the media route serves them: the file as it was uploaded, or a resized copy
// of a photo. Copies are made from the photo the first time each is asked for and kept in storage;
// requests for one that's being made wait for it rather than make it again.
import { Context, Deferred, Effect, Layer } from 'effect'

import { IMAGE_WIDTHS, isResizableImage } from '../../lib/image-widths.ts'
import { hash, Images } from '../../lib/images.ts'
import { MediaStorage, mediaKeys, type StoredFile } from '../../lib/media-storage.ts'
import { getPostFileNames, isPostFileName } from './post.ts'
import { PostQueries } from './queries.ts'

type Options = { readonly unpublished?: boolean | undefined }

export class PostMedia extends Context.Service<
  PostMedia,
  {
    // A post's file, if the post is published and names it. The composer stores files before
    // the post is saved, and they stay private until then, except to the composer
    // (`unpublished`).
    readonly original: (
      id: string,
      name: string,
      options?: Options,
    ) => Effect.Effect<StoredFile | undefined>
    // A post's image resized to one of IMAGE_WIDTHS, as WebP, if the post is published and names
    // it (or `unpublished`), and `version` is its current one.
    readonly resized: (
      id: string,
      name: string,
      width: number,
      version: string,
      options?: Options,
    ) => Effect.Effect<StoredFile | undefined>
  }
>()('logspace/PostMedia') {
  static readonly layer = Layer.effect(
    PostMedia,
    Effect.gen(function* () {
      let storage = yield* MediaStorage
      let images = yield* Images
      let posts = yield* PostQueries
      let inProgress = new Map<string, Deferred.Deferred<StoredFile | undefined>>()

      let isServed = (id: string, name: string, options: Options | undefined) =>
        options?.unpublished
          ? Effect.succeed(true)
          : Effect.map(
              posts.findRecord(id),
              (post) => post !== undefined && getPostFileNames(post).includes(name),
            )

      let original = Effect.fn('PostMedia.original')(function* (
        id: string,
        name: string,
        options?: Options,
      ) {
        if (!isPostFileName(name) || !(yield* isServed(id, name, options))) return undefined
        return yield* storage.get(mediaKeys.postFile(id, name))
      })

      // Made from the photo only if it's the version asked for: while a photo is being replaced,
      // a request for the old version could otherwise store the new one under the old's URL. A
      // photo Bun can't decode has no resized copies, and pages that ask get a 404.
      let make = (id: string, name: string, width: number, version: string, key: string) =>
        Effect.gen(function* () {
          let file = yield* storage.get(mediaKeys.postFile(id, name))
          if (!file) return undefined
          let bytes = new Uint8Array(yield* Effect.promise(() => file.blob.arrayBuffer()))
          if (hash(bytes) !== version) return undefined
          yield* storage.put(key, yield* images.resize(bytes, width))
          return yield* storage.get(key)
        }).pipe(
          Effect.catchTag('ImageUnreadable', (error) =>
            Effect.as(Effect.logWarning(`Couldn't resize ${key}`, error.cause), undefined),
          ),
        )

      let resized = Effect.fn('PostMedia.resized')(function* (
        id: string,
        name: string,
        width: number,
        version: string,
        options?: Options,
      ) {
        if (!IMAGE_WIDTHS.includes(width) || !isResizableImage(name)) return undefined
        if (!isPostFileName(name) || !(yield* isServed(id, name, options))) return undefined
        let info = yield* posts.imageInfo(id, name)
        if (info?.version !== version) return undefined
        let key = `${mediaKeys.variants(id, name)}${width}-${version}.webp`
        let existing = yield* storage.get(key)
        if (existing) return existing

        let pending = inProgress.get(key)
        if (!pending) {
          let deferred = Deferred.makeUnsafe<StoredFile | undefined>()
          inProgress.set(key, deferred)
          pending = deferred
          // Made to the end even if this request goes away, since others may be waiting for it.
          yield* Effect.uninterruptible(
            Effect.flatMap(Effect.exit(make(id, name, width, version, key)), (result) =>
              Effect.sync(() => {
                inProgress.delete(key)
                Deferred.doneUnsafe(deferred, result)
              }),
            ),
          )
        }
        return yield* Deferred.await(pending)
      })

      return PostMedia.of({ original, resized })
    }),
  )
}
