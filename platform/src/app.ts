// The composition root: every service, and the routes, wired together. Read this file to see
// what depends on what. Each layer is built once and shared.
//
//   AppConfig ─┬─ Database ── Migrations
//              ├─ MediaStorage, Images, AdminAuth, Assets
//              │
//   queries/ (the read side):  SiteConfigQueries, PostQueries, SiteFiles, PostMedia, LinkPreviews
//   commands/ (the write side): PostFiles, PostCommands, SiteConfigCommands
//   http/ (the routes):         PublicRoutes, AdminRoutes, and AppMiddleware around them all
import { BunFileSystem } from '@effect/platform-bun'
import { Effect, Layer } from 'effect'
import { FetchHttpClient } from 'effect/http'

import { PostFiles } from './commands/post-files.ts'
import { PostCommands } from './commands/posts.ts'
import { SiteConfigCommands } from './commands/site-config.ts'
import { AdminRoutes } from './http/admin.tsx'
import { Assets } from './http/assets.ts'
import { AppMiddleware } from './http/middleware.ts'
import { PublicRoutes } from './http/public.tsx'
import { AdminAuth } from './http/session.ts'
import { LinkPreviews } from './queries/link-previews.ts'
import { PostMedia } from './queries/post-media.ts'
import { PostQueries } from './queries/posts.ts'
import { SiteConfigQueries } from './queries/site-config.ts'
import { SiteFiles } from './queries/site-files.ts'
import { DatabaseLive, Migrations } from './services/database.ts'
import { Images } from './services/images.ts'
import { MediaStorage } from './services/media-storage.ts'

const Infrastructure = Migrations.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(DatabaseLive, MediaStorage.layer, Images.layer)),
  Layer.provideMerge(BunFileSystem.layer),
)

const Queries = Layer.mergeAll(
  PostMedia.layer,
  LinkPreviews.layer.pipe(Layer.provide(FetchHttpClient.layer)),
).pipe(
  Layer.provideMerge(Layer.mergeAll(SiteConfigQueries.layer, PostQueries.layer, SiteFiles.layer)),
)

const Commands = Layer.mergeAll(PostCommands.layer, SiteConfigCommands.layer).pipe(
  Layer.provideMerge(PostFiles.layer),
)

// Every service the routes use, given AppConfig. The database is migrated before anything else
// reads it.
export const AppServices = Layer.mergeAll(AdminAuth.layer, Assets.layer).pipe(
  Layer.provideMerge(Commands),
  Layer.provideMerge(Queries),
  Layer.provideMerge(
    Layer.effectDiscard(Effect.flatMap(Migrations, (migrations) => migrations.run())).pipe(
      Layer.provideMerge(Infrastructure),
    ),
  ),
)

// How routes match: /posts/<id>/ (with a trailing slash) isn't /posts/<id>, as in LogSpace 0.1.
export const ROUTER_CONFIG = { ignoreTrailingSlash: false }

// The routes, with the middleware around them. The services they use are provided around them
// (see cli/start.ts, and test/app.ts).
export const AppRoutes = Layer.mergeAll(PublicRoutes, AdminRoutes, AppMiddleware)
