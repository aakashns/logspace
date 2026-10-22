import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import * as assert from 'remix/assert'
import { createFsFileStorage } from 'remix/file-storage/fs'
import { createMemoryFileStorage } from 'remix/file-storage/memory'
import { createFileResponse } from 'remix/response/file'
import { afterAll, beforeAll, describe, it } from 'remix/test'

import {
  createMediaStorage,
  deletePostFiles,
  getPostFile,
  getPostImages,
  getPostImageVariant,
  listPostFiles,
  savePostFile,
} from './media.ts'
import { migrateDatabase } from './db.ts'
import sharp from 'sharp'
import { seedMedia, TEST_CONTENT_DIR } from '../../test/seed.ts'

const ID = 'steq6e0rsh'

let tmp: string
beforeAll(async () => {
  // Saving an image records its size in the database.
  await migrateDatabase()
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'media-test-'))
})
afterAll(async () => {
  await fsp.rm(tmp, { recursive: true, force: true })
})

describe('createMediaStorage', () => {
  it('uses a folder by default, MEDIA_DIR if set', async () => {
    let dir = path.join(tmp, 'fs-storage')
    let { storage, location } = createMediaStorage({ MEDIA_DIR: dir })
    assert.equal(location, dir)
    await savePostFile(ID, 'a.txt', new File(['hi'], 'a.txt'), storage)
    assert.equal(await (await getPostFile(ID, 'a.txt', storage))?.text(), 'hi')
  })

  it('rejects an unknown backend and an incomplete S3 config', () => {
    assert.throws(() => createMediaStorage({ MEDIA_STORAGE: 'ftp' }), /Unknown MEDIA_STORAGE "ftp"/)
    assert.throws(
      () => createMediaStorage({ MEDIA_STORAGE: 's3', MEDIA_S3_BUCKET: 'media' }),
      /MEDIA_STORAGE=s3 needs MEDIA_S3_REGION/,
    )
  })

  it('reaches Cloudflare R2 through the S3 backend, with a custom endpoint', async () => {
    let { storage, location } = createMediaStorage({
      MEDIA_STORAGE: 's3',
      MEDIA_S3_BUCKET: 'media',
      MEDIA_S3_REGION: 'auto',
      MEDIA_S3_ENDPOINT: 'https://0123abcd.r2.cloudflarestorage.com',
      MEDIA_S3_ACCESS_KEY_ID: 'key-id',
      MEDIA_S3_SECRET_ACCESS_KEY: 'secret',
    })
    assert.equal(location, 's3://media at https://0123abcd.r2.cloudflarestorage.com')

    let requests: Request[] = []
    let realFetch = globalThis.fetch
    globalThis.fetch = async (input) => {
      requests.push(input as Request)
      return new Response(null, { status: 404 })
    }
    try {
      assert.equal(await storage.has(`posts/${ID}/a b.jpg`), false)
    } finally {
      globalThis.fetch = realFetch
    }

    // Path-style (R2 serves buckets that way at the account endpoint), signed for region "auto".
    assert.equal(requests.length, 1)
    assert.equal(requests[0].method, 'HEAD')
    assert.equal(
      requests[0].url,
      `https://0123abcd.r2.cloudflarestorage.com/media/posts/${ID}/a%20b.jpg`,
    )
    assert.match(requests[0].headers.get('Authorization') ?? '', /\/auto\/s3\/aws4_request/)
  })
})

describe('savePostFile', () => {
  it('names and types the file by its name, not by what the file claims', async () => {
    let storage = createMemoryFileStorage()
    let upload = new File(['<script>'], 'evil.html', { type: 'text/html' })
    await savePostFile(ID, 'photo.jpg', upload, storage)
    let file = await getPostFile(ID, 'photo.jpg', storage)
    assert.equal(file?.name, 'photo.jpg')
    assert.equal(file?.type, 'image/jpeg')
  })

  it('rejects names that are paths or hidden files', async () => {
    let storage = createMemoryFileStorage()
    for (let name of ['../posts.json', 'a/b.jpg', '.hidden']) {
      await assert.rejects(() => savePostFile(ID, name, new File([''], 'x'), storage), /Invalid/)
    }
  })
})

describe('post images', () => {
  // A 1000×500 JPEG, saved sideways (EXIF orientation 6) to check that sizes are upright.
  let photo = async (color: string) =>
    new File(
      [
        new Uint8Array(
          await sharp({ create: { width: 500, height: 1000, channels: 3, background: color } })
            .withMetadata({ orientation: 6 })
            .jpeg()
            .toBuffer(),
        ),
      ],
      'x.jpg',
    )

  it('records an image’s upright size and a hash when it’s saved', async () => {
    let storage = createMemoryFileStorage()
    await savePostFile(ID, 'big.jpg', await photo('red'), storage)
    await savePostFile(ID, 'not-really.jpg', new File(['nope'], 'x'), storage)
    let images = await getPostImages([
      [ID, 'big.jpg'],
      [ID, 'not-really.jpg'],
    ])
    let info = images.get(`posts/${ID}/big.jpg`)
    assert.equal(info?.width, 1000)
    assert.equal(info?.height, 500)
    assert.match(info?.version ?? '', /^[0-9a-f]{12}$/)
    assert.equal(images.has(`posts/${ID}/not-really.jpg`), false)
  })

  it('makes resized WebP copies on request, for the current version only', async () => {
    let storage = createMemoryFileStorage()
    await savePostFile(ID, 'big.jpg', await photo('red'), storage)
    let key = `posts/${ID}/big.jpg`
    let { version } = (await getPostImages([[ID, 'big.jpg']])).get(key)!

    let variant = await getPostImageVariant(ID, 'big.jpg', 480, version, storage)
    assert.equal(variant?.type, 'image/webp')
    let metadata = await sharp(new Uint8Array(await variant!.arrayBuffer())).metadata()
    assert.equal(metadata.format, 'webp')
    assert.equal(metadata.width, 480)
    assert.equal(metadata.height, 240)
    // It's kept, not made again.
    assert.equal((await storage.list({ prefix: `variants/${ID}/big.jpg/` })).files.length, 1)
    // Never wider than the image.
    let widest = await getPostImageVariant(ID, 'big.jpg', 1160, version, storage)
    let { width } = await sharp(new Uint8Array(await widest!.arrayBuffer())).metadata()
    assert.equal(width, 1000)

    assert.equal(await getPostImageVariant(ID, 'big.jpg', 481, version, storage), null)
    assert.equal(await getPostImageVariant(ID, 'big.jpg', 480, 'old', storage), null)

    // Replacing the image drops its copies and changes its version.
    await savePostFile(ID, 'big.jpg', await photo('blue'), storage)
    assert.equal((await storage.list({ prefix: `variants/${ID}/` })).files.length, 0)
    assert.notEqual((await getPostImages([[ID, 'big.jpg']])).get(key)?.version, version)
    assert.equal(await getPostImageVariant(ID, 'big.jpg', 480, version, storage), null)

    await deletePostFiles(ID, storage)
    assert.equal((await getPostImages([[ID, 'big.jpg']])).size, 0)
  })
})

describe('deletePostFiles', () => {
  it('removes every file of one post, from disk too, and leaves the others', async () => {
    let storage = createFsFileStorage(path.join(tmp, 'delete'))
    await seedMedia(storage)
    // More files than a page of the fs backend's list() (32), so it has to follow the cursor.
    for (let i = 0; i < 40; i++) {
      await savePostFile(ID, `extra-${i}.jpg`, new File([String(i)], 'x'), storage)
    }

    let removed = await deletePostFiles(ID, storage)
    assert.equal(removed.length, 42)
    assert.ok(removed.every((key) => key.startsWith(`posts/${ID}/`)))
    assert.equal(await getPostFile(ID, 'flower.mp4', storage), null)
    assert.equal((await storage.list({ prefix: `posts/${ID}/` })).files.length, 0)
    let { files } = await storage.list({ prefix: 'posts/', limit: 100 })
    assert.equal(files.length, 7)
    assert.deepEqual(await deletePostFiles(ID, storage), [])
  })
})

describe('listPostFiles', () => {
  it('lists one post’s files by name, with their sizes', async () => {
    let storage = createMemoryFileStorage()
    await savePostFile(ID, 'b.jpg', new File(['bb'], 'x'), storage)
    await savePostFile(ID, 'a.mp4', new File(['a'], 'x'), storage)
    await savePostFile('drdp3ei6fd', 'other.jpg', new File(['o'], 'x'), storage)
    assert.deepEqual(await listPostFiles(ID, storage), [
      { name: 'a.mp4', size: 1 },
      { name: 'b.jpg', size: 2 },
    ])
  })
})

describe('fs storage', () => {
  it('stores files on disk that are served in ranges, with their type', async () => {
    let storage = createFsFileStorage(path.join(tmp, 'served'))
    await seedMedia(storage)
    let file = await getPostFile(ID, 'flower.mp4', storage)
    assert.ok(file)

    let request = new Request('http://localhost/', { headers: { Range: 'bytes=10-19' } })
    let response = await createFileResponse(file, request)
    assert.equal(response.status, 206)
    assert.equal(response.headers.get('Content-Type'), 'video/mp4')
    let source = await fsp.readFile(path.join(TEST_CONTENT_DIR, 'posts', ID, 'flower.mp4'))
    assert.deepEqual(
      [...new Uint8Array(await response.arrayBuffer())],
      [...source.subarray(10, 20)],
    )
  })
})
