// The list of posts at /admin. Posts are written, edited, and deleted in the composer
// (composer.tsx).
import { Effect } from 'effect'
import { HttpRouter } from 'effect/http'

import { adminPage, loggedIn } from '../../admin/pages.tsx'
import { redirect } from '../../http/responses.ts'
import { routes } from '../../routes.ts'
import { SiteConfigQueries } from '../../site/queries.ts'
import { isSiteConfigured } from '../../site/site.ts'
import { PostQueries } from '../queries.ts'
import { PostsPage } from './components/posts.tsx'

const index = loggedIn(() =>
  Effect.gen(function* () {
    // The site's required settings come first.
    if (!isSiteConfigured(yield* (yield* SiteConfigQueries).saved)) {
      return redirect(routes.admin.config())
    }
    let posts = yield* (yield* PostQueries).all
    return yield* adminPage('Manage Site', <PostsPage posts={posts} />)
  }),
)

export const ManageRoutes = HttpRouter.addAll([HttpRouter.route('GET', '/admin', index)])
