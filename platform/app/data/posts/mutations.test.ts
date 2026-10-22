import * as assert from 'remix/assert'
import { beforeAll, beforeEach, describe, it } from 'remix/test'

import { readTestPosts, seedDatabase, seedMedia } from '../../../test/seed.ts'
import { db } from '../db.ts'
import { deletePostFiles, hasPostFile, mediaStorage, savePostFile } from '../media.ts'
import { getPostFileNames } from './model.ts'
import { createPost, deletePost, updatePost } from './mutations.ts'
import { getPostRecord } from './store.ts'

const ID = 'newpost001'
let post = { id: ID, type: 'video', date: '2026-10-21T09:30:00+05:30', video: { file: 'a.mp4' } }
let uploads = [{ name: 'a.mp4', file: new File(['a'], 'a.mp4') }]

beforeAll(seedMedia)
beforeEach(async () => {
  await seedDatabase()
  await deletePostFiles(ID)
})

describe('test content', () => {
  it('has every file its posts name', async () => {
    for (let post of await readTestPosts()) {
      for (let file of getPostFileNames(post)) assert.ok(await hasPostFile(post.id, file), file)
    }
  })
})

describe('createPost', () => {
  it('leaves a post’s uploads in storage when storing the post fails', async (t) => {
    t.mock.method(db, 'create', () => Promise.reject(new Error('Database unavailable')))
    await assert.rejects(createPost({ post, uploads, issues: [] }), /Database unavailable/)
    assert.equal(await getPostRecord(ID), undefined)
    assert.equal(await hasPostFile(ID, 'a.mp4'), true)
  })
})

describe('updatePost', () => {
  it('won’t change a post’s type, or edit one that doesn’t exist', async () => {
    let [existing] = await readTestPosts()
    let changed = { ...post, id: existing.id, type: existing.type === 'text' ? 'video' : 'text' }
    let result = await updatePost(existing.id, { post: changed, uploads, issues: [] })
    assert.equal(result?.success, false)
    assert.deepEqual(await getPostRecord(existing.id), existing)
    assert.equal(await hasPostFile(existing.id, 'a.mp4'), false)
    assert.equal(await updatePost(ID, { post, uploads, issues: [] }), undefined)
  })
})

describe('deletePost', () => {
  it('leaves the files when removing them fails, after the post is gone', async (t) => {
    await createPost({ post, uploads, issues: [] })
    t.mock.method(mediaStorage, 'remove', () => Promise.reject(new Error('Storage unavailable')))
    await assert.rejects(deletePost(ID), /Storage unavailable/)
    assert.equal(await getPostRecord(ID), undefined)
    assert.equal(await hasPostFile(ID, 'a.mp4'), true)
  })

  it('leaves other posts’ files alone', async () => {
    let [other] = await readTestPosts()
    await savePostFile(other.id, 'keep.jpg', new File(['k'], 'keep.jpg'))
    await createPost({ post, uploads, issues: [] })
    await deletePost(ID)
    assert.equal(await hasPostFile(other.id, 'keep.jpg'), true)
  })
})
