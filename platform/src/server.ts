// The composition root: each service wired to its dependencies and merged into the app, its
// routes, and the server that serves them on a port. Reusing these layer values shares the
// database, storage, caches, and write locks.
import { BunFileSystem, BunHttpServer } from '@effect/platform-bun'
import { Effect, Layer } from 'effect'
import { HttpRouter } from 'effect/http'
import { SqlClient } from 'effect/sql'

import { PostCommands } from './commands/posts.ts'
import { SiteConfigCommands } from './commands/site-config.ts'
import { AppConfig } from './config.ts'
import { AdminRoutes } from './http/admin.tsx'
import { Assets } from './http/assets.ts'
import { AppMiddleware } from './http/middleware.ts'
import { PublicRoutes } from './http/public.tsx'
import { AdminAuth } from './http/session.ts'
import { LinkPreviews } from './queries/link-previews.ts'
import { PostMedia } from './queries/post-media.ts'
import { PostQueries } from './queries/posts.ts'
import { SiteConfigQueries } from './queries/site-config.ts'
import { DatabaseLive, runMigrations } from './services/database.ts'
import { PublicHttpLive, PublicNetwork } from './services/public-http.ts'
import { Images } from './services/images.ts'
import { MediaStorage } from './services/media-storage.ts'

// No consumer gets the connection until its schema is ready. The migrate CLI uses DatabaseLive
// directly so a dry run doesn't apply migrations.
const MigratedDatabase = Layer.effect(
  SqlClient.SqlClient,
  Effect.gen(function* () {
    let sql = yield* SqlClient.SqlClient
    yield* runMigrations({})
    return sql
  }),
).pipe(Layer.provide(DatabaseLive), Layer.provide(BunFileSystem.layer))

const PostQueriesLive = PostQueries.layer.pipe(
  Layer.provide([MigratedDatabase, MediaStorage.layer]),
)
const SiteConfigQueriesLive = SiteConfigQueries.layer.pipe(Layer.provide(MigratedDatabase))

// Requires AppConfig and PublicNetwork. SQL and media services are exposed for seeding and file
// queries; the remaining outputs are the APIs used by routes and the server's shutdown hook.
export const AppServices = Layer.mergeAll(
  MigratedDatabase,
  MediaStorage.layer,
  Images.layer,
  PostQueriesLive,
  SiteConfigQueriesLive,
  Assets.layer,
  AdminAuth.layer.pipe(Layer.provide(MigratedDatabase)),
  PostCommands.layer.pipe(Layer.provide([MigratedDatabase, MediaStorage.layer, Images.layer])),
  SiteConfigCommands.layer.pipe(
    Layer.provide([MigratedDatabase, MediaStorage.layer, Images.layer, SiteConfigQueriesLive]),
  ),
  PostMedia.layer.pipe(Layer.provide([MediaStorage.layer, Images.layer, PostQueriesLive])),
  LinkPreviews.layer.pipe(
    Layer.provide([
      SiteConfigQueriesLive,
      MediaStorage.layer,
      Images.layer,
      BunFileSystem.layer,
      PublicHttpLive,
    ]),
  ),
)

// The normal assembly for servers and scripts. Tests can supply a network to AppServices.
export const AppLive = AppServices.pipe(Layer.provide(PublicNetwork.layer))

// How routes match: /posts/<id>/ (with a trailing slash) isn't /posts/<id>, as in LogSpace 0.1.
export const ROUTER_CONFIG = { ignoreTrailingSlash: false }

// ServerLive serves these routes; tests drive them through an in-memory web handler.
export const AppRoutes = Layer.mergeAll(PublicRoutes, AdminRoutes, AppMiddleware)

// The app on AppConfig's port. Retains the app services and listener for startup logging and the
// browser fixture's address.
export const ServerLive = Layer.unwrap(
  Effect.gen(function* () {
    let { port, hostname } = yield* AppConfig
    return HttpRouter.serve(AppRoutes, { disableLogger: true, routerConfig: ROUTER_CONFIG }).pipe(
      Layer.provideMerge(AppLive),
      Layer.provideMerge(
        BunHttpServer.layer({
          port,
          hostname,
          // Bun closes a connection after 10 seconds without sending or receiving anything by
          // default, even while a response is being made, like a big photo's first resize.
          // 255 seconds is its longest.
          idleTimeout: 255,
        }),
      ),
    )
  }),
)
