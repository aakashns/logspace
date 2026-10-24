// The list of posts at /admin. Posts are written, edited, and deleted in the composer
// (composer.tsx).
import { Effect } from 'effect'

import { isSiteConfigured } from '../../domain/site.ts'
import { PostQueries } from '../../queries/posts.ts'
import { SiteConfigQueries } from '../../queries/site-config.ts'
import { routes } from '../../routes.ts'
import { PostsPage } from '../../views/admin/posts.tsx'
import { redirect } from '../responses.ts'
import { adminPage, loggedIn } from './pages.tsx'

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
