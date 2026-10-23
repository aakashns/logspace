// Where uploaded media is kept: posts' photos, videos, and posters under posts/<id>/<file>, their
// resized copies under variants/<id>/<file>/<width>-<version>.webp, and the site's logo, icon,
// and social preview image under site/<file>. Keys are always built from a checked post id and
// file name (see isPostFileName in domain/post.ts), so none can point outside its folder.
//
// The fs backend keeps each key as a file of that name under MEDIA_DIR, written with Bun's file
// APIs. Files are written beside their destination and renamed into place, so a reader never sees
// half a file, and they're served straight from disk (see http/responses.ts), so a range request
// for a video reads only the bytes it asks for. The memory backend is for the tests.
//
// Storage failures are unexpected (a full disk, a permissions mistake), so they're defects: the
// request fails with a 500 and the error is logged.
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { Clock, Context, Effect, Layer, Predicate } from 'effect'

import { AppConfig } from '../config.ts'
import { mimeType } from '../domain/post.ts'

// Where each kind of file is kept.
export const mediaKeys = {
  postFile: (id: string, name: string) => `posts/${id}/${name}`,
  postFiles: (id: string) => `posts/${id}/`,
  // A post's file's resized copies, each <width>-<version>.webp (see queries/post-media.ts).
  variants: (id: string, name: string) => `variants/${id}/${name}/`,
  postVariants: (id: string) => `variants/${id}/`,
  siteFile: (name: string) => `site/${name}`,
}

// A stored file. `blob` is read lazily: for the fs backend it's a BunFile, which Bun can send
// with sendfile().
export interface StoredFile {
  readonly blob: Blob
  readonly size: number
  readonly type: string
  readonly lastModified: number
}

export class MediaStorage extends Context.Service<
  MediaStorage,
  {
    readonly get: (key: string) => Effect.Effect<StoredFile | undefined>
    readonly has: (key: string) => Effect.Effect<boolean>
    // Replaces any file under the key. Its type is the key's extension's.
    readonly put: (key: string, data: Blob | Uint8Array) => Effect.Effect<void>
    readonly remove: (key: string) => Effect.Effect<void>
    // The files whose keys start with `prefix` (which ends with "/"), with their sizes.
    readonly list: (prefix: string) => Effect.Effect<{ key: string; size: number }[]>
    // A description of where files go, for the server's startup log.
    readonly location: string
  }
>()('logspace/MediaStorage') {
  static readonly layer = Layer.unwrap(
    Effect.gen(function* () {
      let config = yield* AppConfig
      return config.mediaStorage === 'memory'
        ? Layer.sync(MediaStorage, makeMemoryStorage)
        : Layer.sync(MediaStorage, () => makeFsStorage(config.mediaDir))
    }),
  )
}

const typeOf = (key: string) => mimeType(key) ?? 'application/octet-stream'

function makeFsStorage(root: string): MediaStorage['Service'] {
  let file = (key: string) => {
    let resolved = path.resolve(root, key)
    if (!resolved.startsWith(root + path.sep)) throw new Error(`Invalid media key "${key}"`)
    return resolved
  }

  return MediaStorage.of({
    location: root,
    get: (key) =>
      Effect.promise(async () => {
        let blob = Bun.file(file(key), { type: typeOf(key) })
        try {
          let stat = await blob.stat()
          if (!stat.isFile()) return undefined
          return { blob, size: stat.size, type: blob.type, lastModified: stat.mtimeMs }
        } catch (error) {
          if (isNotFound(error)) return undefined
          throw error
        }
      }),
    has: (key) => Effect.promise(() => Bun.file(file(key)).exists()),
    put: (key, data) =>
      Effect.promise(async () => {
        let target = file(key)
        let temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`
        await fsp.mkdir(path.dirname(target), { recursive: true })
        try {
          await Bun.write(temp, data)
          await fsp.rename(temp, target)
        } finally {
          await fsp.rm(temp, { force: true })
        }
      }),
    remove: (key) => Effect.promise(() => fsp.rm(file(key), { force: true })),
    list: (prefix) =>
      Effect.promise(async () => {
        let dir = file(prefix)
        let entries = await fsp
          .readdir(dir, { recursive: true, withFileTypes: true })
          .catch((error: unknown) => {
            if (isNotFound(error)) return []
            throw error
          })
        let files = entries.filter((entry) => entry.isFile() && !entry.name.endsWith('.tmp'))
        return Promise.all(
          files.map(async (entry) => {
            let full = path.join(entry.parentPath, entry.name)
            let key = path.relative(root, full).split(path.sep).join('/')
            return { key, size: (await fsp.stat(full)).size }
          }),
        )
      }),
  })
}

const isNotFound = (error: unknown) =>
  Predicate.hasProperty(error, 'code') && error.code === 'ENOENT'

function makeMemoryStorage(): MediaStorage['Service'] {
  let files = new Map<string, StoredFile>()
  return MediaStorage.of({
    location: 'memory',
    get: (key) => Effect.sync(() => files.get(key)),
    has: (key) => Effect.sync(() => files.has(key)),
    put: Effect.fnUntraced(function* (key, data) {
      // Copied, so the stored file doesn't depend on the upload staying around.
      let bytes = new Uint8Array(
        data instanceof Blob ? yield* Effect.promise(() => data.arrayBuffer()) : data,
      )
      let blob = new Blob([bytes], { type: typeOf(key) })
      let lastModified = yield* Clock.currentTimeMillis
      files.set(key, { blob, size: blob.size, type: blob.type, lastModified })
    }),
    remove: (key) => Effect.sync(() => void files.delete(key)),
    list: (prefix) =>
      Effect.sync(() =>
        [...files]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, file]) => ({ key, size: file.size })),
      ),
  })
}
