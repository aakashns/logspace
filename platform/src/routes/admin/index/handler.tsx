// /admin: a link to each part of the admin.
import { Effect } from 'effect'
import { HttpRouter } from 'effect/http'

import { SiteConfigQueries } from '../../../data/site/queries.ts'
import { isSiteConfigured } from '../../../data/site/site.ts'
import { redirect } from '../../../lib/http/responses.ts'
import { urls } from '../../../lib/urls.ts'
import { adminOnly, adminPage } from '../admin.tsx'
import { ADMIN_INDEX_STYLES, AdminIndexPage } from './page.tsx'

const index = adminOnly(() =>
  Effect.gen(function* () {
    // The site's required settings come first.
    if (!isSiteConfigured(yield* (yield* SiteConfigQueries).saved)) {
      return redirect(urls.admin.branding())
    }
    return yield* adminPage('Manage Site', <AdminIndexPage />, { styles: ADMIN_INDEX_STYLES })
  }),
)

export const AdminIndexRoutes = HttpRouter.addAll([HttpRouter.route('GET', '/admin', index)])
