import { fileURLToPath } from 'node:url'
import { createRouter, type MiddlewareContext } from 'remix/router'
import { cop } from 'remix/middleware/cop'
import { render } from 'remix/middleware/render'
import { staticFiles } from 'remix/middleware/static'

import adminConfigController from './actions/admin/config/controller.tsx'
import adminController from './actions/admin/controller.tsx'
import editPostController from './actions/admin/posts/edit/controller.tsx'
import newPostController from './actions/admin/posts/new/controller.tsx'
import adminPostsController from './actions/admin/posts/controller.tsx'
import controller from './actions/controller.tsx'
import postsController from './actions/posts/controller.tsx'
import { assets } from './assets.ts'
import { securityHeaders } from './middleware/security-headers.ts'
import { requireSiteConfig, siteConfig } from './middleware/site-config.ts'
import { routes } from './routes.ts'

// Root public/, or the copy of it the binary writes out (see binary/main.ts).
const PUBLIC_DIR = process.env.PUBLIC_DIR ?? fileURLToPath(new URL('../public/', import.meta.url))

const renderMiddleware = render({ assets })
export type AppContext = MiddlewareContext<[typeof renderMiddleware]>

declare module 'remix' {
  interface RouterTypes {
    context: AppContext
  }
}

export const router = createRouter<AppContext>({
  middleware: [
    securityHeaders(),
    // Rejects form posts from other sites, so a page elsewhere can't act with an admin login.
    cop(),
    // Font files never change in place (a new version gets a new name), so browsers can keep them.
    staticFiles(PUBLIC_DIR, {
      filter: (path) => path.startsWith('fonts/'),
      cacheControl: 'public, max-age=31536000, immutable',
    }),
    staticFiles(PUBLIC_DIR, { index: false }),
    siteConfig(),
    // Sends visitors to /admin until the site's required settings are saved.
    requireSiteConfig(),
    renderMiddleware,
  ],
})

router.map(routes, controller)
router.map(routes.posts, postsController)
router.map(routes.admin, adminController)
router.map(routes.admin.config, adminConfigController)
router.map(routes.admin.posts, adminPostsController)
router.map(routes.admin.posts.new, newPostController)
router.map(routes.admin.posts.edit, editPostController)
