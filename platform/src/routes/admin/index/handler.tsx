// /admin: a card for each part of the admin.
import { Effect } from 'effect'
import { HttpRouter } from 'effect/http'

import { PostQueries } from '../../../data/posts/queries.ts'
import { SiteConfigQueries } from '../../../data/site/queries.ts'
import { isSiteConfigured } from '../../../data/site/site.ts'
import { redirect } from '../../../lib/http/responses.ts'
import { urls } from '../../../lib/urls.ts'
import { adminPage, loggedIn } from '../admin.tsx'
import { ADMIN_INDEX_STYLES, AdminIndexPage } from './page.tsx'

const index = loggedIn(() =>
  Effect.gen(function* () {
    let site = yield* (yield* SiteConfigQueries).saved
    // The site's required settings come first.
    if (!isSiteConfigured(site)) return redirect(urls.admin.branding())
    let posts = yield* (yield* PostQueries).all
    return yield* adminPage(
      'Manage Site',
      <AdminIndexPage postCount={posts.length} site={site} />,
      { styles: ADMIN_INDEX_STYLES },
    )
  }),
)

export const AdminIndexRoutes = HttpRouter.addAll([HttpRouter.route('GET', '/admin', index)])
