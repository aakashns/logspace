import { db } from '../db.ts'
import { deletePostFiles, hasPostFile, savePostFile } from '../media.ts'
import { posts } from '../tables.ts'
import { getPostFileNames, isPostId, parsePostRecord, type PostIssue } from './model.ts'
import { getPostRecord, toPostRow } from './store.ts'

// Publishing, editing, and deleting posts. Media storage and the database can't change together,
// so each says what's left when one step fails.

export interface PostSubmission {
  // The post as submitted, unchecked.
  post: { id: string; type: string }
  // Files chosen with it, saved as the post's files under `name`, replacing any of the same names.
  uploads: { name: string; file: File }[]
  // Problems already found in the submission. One with any isn't saved, though its uploads are.
  issues: PostIssue[]
}

type SaveResult = { success: true } | { success: false; issues: PostIssue[] }

// Uploads are saved before the post is checked, so a rejected submission doesn't need its files
// chosen again. A new post's id can only be taken by a form submitted twice (every new post form
// has a new id), and then nothing is saved, so its files can't replace the published post's. If
// storing the post fails, its files stay under its id, unserved, for the form to be submitted again.
export async function createPost(submission: PostSubmission): Promise<SaveResult> {
  let { id } = submission.post
  if (await db.find(posts, id)) {
    return { success: false, issues: [{ message: 'This post was already published.' }] }
  }
  // An invalid id is one of the post's issues; no files are saved under it.
  if (isPostId(id)) await saveUploads(id, submission)
  let result = await check(submission)
  if (result.success) await db.create(posts, toPostRow(result.record))
  return result
}

// Undefined when there's no such post. A post's type can't change. Uploads replace the post's
// files of the same names right away, even if the edit is rejected or storing it fails.
export async function updatePost(
  id: string,
  submission: PostSubmission,
): Promise<SaveResult | undefined> {
  let existing = await getPostRecord(id)
  if (!existing) return undefined
  if (submission.post.type !== existing.type) {
    return { success: false, issues: [{ field: 'type', message: 'A post’s type can’t change.' }] }
  }
  await saveUploads(id, submission)
  let result = await check({ ...submission, post: { ...submission.post, id } })
  if (result.success) {
    await db.update(posts, id, {
      ...toPostRow(result.record),
      updated_at: new Date().toISOString(),
    })
  }
  return result
}

// False when there's no such post. The post goes first: if removing its files fails, the files
// left over aren't served, while a post whose files went first would show broken media.
export async function deletePost(id: string) {
  if (!(await db.delete(posts, id))) return false
  await deletePostFiles(id)
  return true
}

async function saveUploads(id: string, { uploads }: PostSubmission) {
  for (let { name, file } of uploads) await savePostFile(id, name, file)
}

// Checks the post, and that every file it names is in media storage.
async function check({ post, issues }: PostSubmission) {
  let parsed = parsePostRecord(post)
  if (!parsed.success) return { success: false as const, issues: [...issues, ...parsed.issues] }
  let { record } = parsed
  let missing: PostIssue[] = []
  for (let file of getPostFileNames(record)) {
    if (await hasPostFile(record.id, file)) continue
    let message = `${file} isn’t one of this post’s files. Choose the file to upload it, or check the name.`
    missing.push({ message })
  }
  issues = [...issues, ...missing]
  return issues.length > 0
    ? { success: false as const, issues }
    : { success: true as const, record }
}
