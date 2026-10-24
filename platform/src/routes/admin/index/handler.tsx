// The list of posts at /admin. Posts are written, edited, and deleted in the composer
// (../compose/).
import { Effect } from 'effect'
import { HttpRouter } from 'effect/http'

import { PostQueries } from '../../../data/posts/queries.ts'
import { SiteConfigQueries } from '../../../data/site/queries.ts'
import { isSiteConfigured } from '../../../data/site/site.ts'
import { redirect } from '../../../lib/http/responses.ts'
import { urls } from '../../../lib/urls.ts'
import { adminPage, loggedIn } from '../admin.tsx'
import { POSTS_PAGE_STYLES, PostsPage } from './page.tsx'

const index = loggedIn(() =>
  Effect.gen(function* () {
    // The site's required settings come first.
    if (!isSiteConfigured(yield* (yield* SiteConfigQueries).saved)) {
      return redirect(urls.admin.config())
    }
    let posts = yield* (yield* PostQueries).all
    return yield* adminPage('Manage Site', <PostsPage posts={posts} />, {
      styles: POSTS_PAGE_STYLES,
    })
  }),
)

export const AdminIndexRoutes = HttpRouter.addAll([HttpRouter.route('GET', '/admin', index)])
