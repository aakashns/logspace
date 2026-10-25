// The list of posts at /admin/posts. Posts are written, edited, and deleted in the composer
// (../compose/).
import { Effect } from 'effect'
import { HttpRouter } from 'effect/http'

import { PostQueries } from '../../../data/posts/queries.ts'
import { adminPage, loggedIn } from '../admin.tsx'
import { POSTS_PAGE_STYLES, PostsPage } from './page.tsx'

const posts = loggedIn(() =>
  Effect.gen(function* () {
    let posts = yield* (yield* PostQueries).all
    return yield* adminPage('Manage Posts', <PostsPage posts={posts} />, {
      styles: POSTS_PAGE_STYLES,
    })
  }),
)

export const PostListRoutes = HttpRouter.addAll([HttpRouter.route('GET', '/admin/posts', posts)])
