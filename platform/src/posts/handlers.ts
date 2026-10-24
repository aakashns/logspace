// Every route for posts: the public pages and feeds, link previews' images, and under /admin, the
// list of posts and the composer.
import { Layer } from 'effect'

import { ComposerRoutes } from './composer/handlers.tsx'
import { FeedRoutes } from './feeds/handlers.ts'
import { LinkPreviewRoutes } from './link-previews/handlers.ts'
import { ManageRoutes } from './manage/handlers.tsx'
import { PageRoutes } from './pages/handlers.tsx'

export const PostRoutes = Layer.mergeAll(
  PageRoutes,
  FeedRoutes,
  LinkPreviewRoutes,
  ManageRoutes,
  ComposerRoutes,
)
