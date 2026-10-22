import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FileStorage } from 'remix/file-storage'
import { createFsFileStorage } from 'remix/file-storage/fs'
import { createMemoryFileStorage } from 'remix/file-storage/memory'
import { createS3FileStorage } from 'remix/file-storage/s3'
import { LazyFile } from 'remix/lazy-file'
import { detectMimeType } from 'remix/mime'
import { and, inList } from 'remix/data-table'

import { db } from './db.ts'
import { IMAGE_WIDTHS, isResizableImage, type ImageInfo } from './image-sources.ts'
import { readImageInfo, resizeImage } from './images.ts'
import { isPostFileName } from './posts/model.ts'
import { postImages } from './tables.ts'

// Post media (photos, videos, posters, covers) is kept in file storage, under keys like
// posts/<id>/<file>, and so are the site's logo, icon, and social preview image, under site/ (see
// site-images.ts). Everything that reads or writes it goes through this module, so where it's kept
// is configuration. MEDIA_STORAGE picks the backend:
//
// - fs (the default): a folder, MEDIA_DIR, outside the repo so `git clean -x` can't delete it
//   (/var/lib/logspace/media in production, see scripts/logspace.service). Without MEDIA_DIR it's
//   the git-ignored media/ folder in the webapp, which `git clean -x` would delete. The folder is
//   the backend's own: files are stored under hashed names, so don't put files in it by hand.
// - s3: a bucket in AWS S3, or at an S3-compatible provider like Cloudflare R2 or MinIO, set with
//   MEDIA_S3_BUCKET, MEDIA_S3_REGION (`auto` for R2), MEDIA_S3_ENDPOINT (for anything but AWS, e.g.
//   https://<account id>.r2.cloudflarestorage.com), MEDIA_S3_ACCESS_KEY_ID, and
//   MEDIA_S3_SECRET_ACCESS_KEY.
// - memory: gone when the process exits, as the tests use (seeded from test/content).
//
// Files get into storage as uploads from the /admin post form, through savePostFile. The size and
// a content hash of each image are kept in the post_images table (see getPostImages), and the
// resized copies pages show (see images.ts) are kept in storage too, under
// variants/<id>/<file>/<width>-<hash>.webp.
export type MediaEnv = Record<string, string | undefined>

export function createMediaStorage(env: MediaEnv = process.env): {
  storage: FileStorage
  location: string
} {
  let backend = env.MEDIA_STORAGE || 'fs'
  switch (backend) {
    case 'fs': {
      let directory = env.MEDIA_DIR
        ? path.resolve(env.MEDIA_DIR)
        : fileURLToPath(new URL('../../media', import.meta.url))
      return { storage: createFsFileStorage(directory), location: directory }
    }
    case 's3': {
      let required = (name: string) => {
        let value = env[name]
        if (!value) throw new Error(`MEDIA_STORAGE=s3 needs ${name}`)
        return value
      }
      let bucket = required('MEDIA_S3_BUCKET')
      let endpoint = env.MEDIA_S3_ENDPOINT || undefined
      let storage = createS3FileStorage({
        bucket,
        region: required('MEDIA_S3_REGION'),
        endpoint,
        accessKeyId: required('MEDIA_S3_ACCESS_KEY_ID'),
        secretAccessKey: required('MEDIA_S3_SECRET_ACCESS_KEY'),
      })
      return { storage, location: `s3://${bucket}${endpoint ? ` at ${endpoint}` : ''}` }
    }
    case 'memory':
      return { storage: createMemoryFileStorage(), location: 'memory' }
    default:
      throw new Error(`Unknown MEDIA_STORAGE "${backend}": expected fs, s3, or memory`)
  }
}

export const { storage: mediaStorage, location: MEDIA_LOCATION } = createMediaStorage()

export const POST_FILES_PREFIX = 'posts/'
const VARIANTS_PREFIX = 'variants/'

// The key a post's file is stored under.
export function getPostFileKey(id: string, name: string) {
  return `${POST_FILES_PREFIX}${id}/${name}`
}

// A post's file, or null if it has none by that name.
export async function getPostFile(id: string, name: string, storage = mediaStorage) {
  if (!isPostFileName(name)) return null
  return storage.get(getPostFileKey(id, name))
}

export async function hasPostFile(id: string, name: string, storage = mediaStorage) {
  return isPostFileName(name) && storage.has(getPostFileKey(id, name))
}

// Stores a file of a post, replacing any it had by that name. Its name and type come from `name`
// rather than from the file, since a browser's upload can claim any type and the type is served as
// the Content-Type.
export async function savePostFile(id: string, name: string, file: File, storage = mediaStorage) {
  if (!isPostFileName(name)) throw new Error(`Invalid post file name "${name}"`)
  let type = detectMimeType(name) ?? 'application/octet-stream'
  // A LazyFile streams its parts, so a big video isn't read into memory to be renamed.
  let stored = new LazyFile([file], name, { type, lastModified: file.lastModified })
  await storage.set(getPostFileKey(id, name), stored)
  // The old file's resized copies and info go with it.
  await removeKeys(storage, await listKeys(storage, getVariantsPrefix(id, name)))
  await db.deleteMany(postImages, { where: { post_id: id, name } })
  if (type.startsWith('image/')) await savePostImageInfo(id, name, stored)
}

// The names and sizes of a post's files, by name. With the fs backend this reads every file's
// metadata, so it's for the /admin post form rather than for public pages.
export async function listPostFiles(id: string, storage = mediaStorage) {
  let prefix = getPostFileKey(id, '')
  let files: { name: string; size: number }[] = []
  let cursor: string | undefined
  do {
    let page = await storage.list({ prefix, includeMetadata: true, cursor })
    files.push(
      ...page.files.map((file) => ({ name: file.key.slice(prefix.length), size: file.size })),
    )
    cursor = page.cursor
  } while (cursor !== undefined)
  return files.toSorted((a, b) => a.name.localeCompare(b.name))
}

// Removes all of a post's files from storage, with their resized copies and info, and returns the
// files' keys.
export async function deletePostFiles(id: string, storage = mediaStorage) {
  let keys = await listKeys(storage, getPostFileKey(id, ''))
  await removeKeys(storage, keys)
  await removeKeys(storage, await listKeys(storage, `${VARIANTS_PREFIX}${id}/`))
  await db.deleteMany(postImages, { where: { post_id: id } })
  return keys
}

// The size and content hash of each of a list of [post id, file name] pairs that's an image saved
// with savePostFile, by key in storage.
export async function getPostImages(
  images: [id: string, name: string][],
): Promise<Map<string, ImageInfo>> {
  let found = new Map<string, ImageInfo>()
  let ids = [...new Set(images.map(([id]) => id))]
  if (ids.length === 0) return found
  let rows = await db.findMany(postImages, {
    where: and(inList('post_id', ids), inList('name', [...new Set(images.map(([, n]) => n))])),
  })
  for (let { post_id, name, width, height, version } of rows) {
    found.set(getPostFileKey(post_id, name), { width, height, version })
  }
  return found
}

// A post's image resized to one of IMAGE_WIDTHS, as WebP, or null if it has no such image or
// `version` isn't its current one. It's made from the image the first time it's asked for, and
// kept in storage. Requests for one that's being made wait for it rather than make it again.
export async function getPostImageVariant(
  id: string,
  name: string,
  width: number,
  version: string,
  storage = mediaStorage,
): Promise<File | null> {
  if (!IMAGE_WIDTHS.includes(width) || !isResizableImage(name)) return null
  let info = (await getPostImages([[id, name]])).get(getPostFileKey(id, name))
  if (info?.version !== version) return null
  let key = `${getVariantsPrefix(id, name)}${width}-${version}.webp`
  let variant = await storage.get(key)
  if (variant) return variant

  let pending = variantsInProgress.get(key)
  if (!pending) {
    pending = (async () => {
      let file = await storage.get(getPostFileKey(id, name))
      if (!file) return null
      let resized = new File([await resizeImage(file, width)], `${width}.webp`, {
        type: 'image/webp',
      })
      return storage.put(key, resized)
    })().finally(() => variantsInProgress.delete(key))
    variantsInProgress.set(key, pending)
  }
  return pending
}

let variantsInProgress = new Map<string, Promise<File | null>>()

// Reads an image's size and hash and stores them, or returns undefined if sharp can't read it (a
// .jpg that isn't one, or a format it doesn't know): pages then show it without a size.
export async function savePostImageInfo(id: string, name: string, file: Blob) {
  let info: ImageInfo
  try {
    info = await readImageInfo(file)
  } catch {
    return undefined
  }
  await db.deleteMany(postImages, { where: { post_id: id, name } })
  await db.create(postImages, { post_id: id, name, ...info })
  return info
}

function getVariantsPrefix(id: string, name: string) {
  return `${VARIANTS_PREFIX}${id}/${name}/`
}

// The keys under a prefix. They're all listed before any is removed, so removing doesn't disturb
// the listing's pages.
async function listKeys(storage: FileStorage, prefix: string) {
  let keys: string[] = []
  let cursor: string | undefined
  do {
    let page = await storage.list({ prefix, cursor })
    keys.push(...page.files.map((file) => file.key))
    cursor = page.cursor
  } while (cursor !== undefined)
  return keys
}

async function removeKeys(storage: FileStorage, keys: string[]) {
  for (let key of keys) await storage.remove(key)
}
