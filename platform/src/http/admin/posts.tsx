// The list of posts at /admin, and editing and deleting them. New posts are written in the
// composer (composer.tsx).
import { Effect } from 'effect'

import { PostCommands } from '../../commands/posts.ts'
import { readPostForm, type PostFormValues } from '../../domain/post-form.ts'
import type { PostIssue } from '../../domain/post.ts'
import { isSiteConfigured } from '../../domain/site.ts'
import { PostQueries } from '../../queries/posts.ts'
import { SiteConfigQueries } from '../../queries/site-config.ts'
import { routes } from '../../routes.ts'
import { PostForm } from '../../views/admin/post-form.tsx'
import { PostsPage } from '../../views/admin/posts.tsx'
import { readForm } from '../forms.ts'
import { param } from '../pages.ts'
import { redirect } from '../responses.ts'
import { adminPage, loggedIn, message } from './pages.tsx'

const postNotFound = message(
  'Post not found',
  <>
    There’s no post with this id. <a href={routes.admin.index()}>See all posts</a>
  </>,
  404,
)

export const index = loggedIn(() =>
  Effect.gen(function* () {
    // The site's required settings come first.
    if (!isSiteConfigured(yield* (yield* SiteConfigQueries).saved)) {
      return redirect(routes.admin.config())
    }
    let posts = yield* (yield* PostQueries).all
    return yield* adminPage('Manage Site', <PostsPage posts={posts} />)
  }),
)

// The edit page. New posts are written in the composer, below.
const postForm = (props: { values: PostFormValues; issues?: readonly PostIssue[] | undefined }) =>
  Effect.gen(function* () {
    let files = yield* (yield* PostQueries).files(props.values.id)
    return yield* adminPage('Edit Post', <PostForm {...props} files={files} />, {
      status: props.issues ? 400 : 200,
    })
  })

export const editPost = loggedIn(() =>
  Effect.gen(function* () {
    let values = yield* (yield* PostQueries).findRecord(yield* param('id'))
    if (!values) return yield* postNotFound
    return yield* postForm({ values })
  }),
)

export const savePost = loggedIn(() =>
  Effect.gen(function* () {
    let id = yield* param('id')
    let existing = yield* (yield* PostQueries).findRecord(id)
    if (!existing) return yield* postNotFound
    let form = readPostForm(yield* readForm(), id, existing.type)
    return yield* (yield* PostCommands).edit(id, form).pipe(
      Effect.map(() => redirect(routes.post(id), 303)),
      Effect.catchTags({
        PostNotFound: () => postNotFound,
        PostRejected: (rejected) => postForm({ values: form.post, issues: rejected.issues }),
      }),
    )
  }),
)

export const deletePost = loggedIn(() =>
  Effect.gen(function* () {
    return yield* (yield* PostCommands).delete(yield* param('id')).pipe(
      Effect.as(redirect(routes.admin.index(), 303)),
      Effect.catchTag('PostNotFound', () => postNotFound),
    )
  }),
)
