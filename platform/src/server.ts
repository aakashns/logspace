// The composition root: each service wired to its dependencies and merged into the app, its
// routes, and the server that serves them on a port. Reusing these layer values shares the
// database, storage, caches, and write locks.
import { BunFileSystem, BunHttpServer } from '@effect/platform-bun'
import { Effect, Layer } from 'effect'
import { FetchHttpClient, HttpRouter } from 'effect/http'
import { SqlClient } from 'effect/sql'

import { LinkPreviews } from './data/link-previews/link-previews.ts'
import { PostCommands } from './data/posts/commands.ts'
import { PostMedia } from './data/posts/media.ts'
import { PostQueries } from './data/posts/queries.ts'
import { SiteConfigCommands } from './data/site/commands.ts'
import { Email } from './data/site/email.ts'
import { SiteConfigQueries } from './data/site/queries.ts'
import { Turnstile } from './data/site/turnstile.ts'
import { UserCommands } from './data/users/commands.ts'
import { AppConfig } from './lib/config.ts'
import { DatabaseLive, runMigrations } from './lib/database.ts'
import { Assets } from './lib/http/assets.ts'
import { AppMiddleware } from './lib/http/middleware.ts'
import { AdminAuth } from './lib/http/admin-session.ts'
import { Images } from './lib/images.ts'
import { MediaStorage } from './lib/media-storage.ts'
import { PublicHttpLive, PublicNetwork } from './lib/public-http.ts'
import { Secrets } from './lib/secrets.ts'
import { ComposeRoutes } from './routes/admin/compose/handler.tsx'
import { BrandingRoutes } from './routes/admin/branding/handler.tsx'
import { AdminIndexRoutes } from './routes/admin/index/handler.tsx'
import { IntegrationRoutes } from './routes/admin/integrations/handler.tsx'
import { AdminLoginRoutes } from './routes/admin/login/handler.tsx'
import { PostListRoutes } from './routes/admin/posts/handler.tsx'
import { SubscriberRoutes } from './routes/admin/subscribers/handler.tsx'
import { AssetRoutes } from './routes/assets/handler.ts'
import { DesignRoutes } from './routes/dev/design/handler.tsx'
import { DevEmailRoutes } from './routes/dev/emails/handler.tsx'
import { DevIndexRoutes } from './routes/dev/index/handler.tsx'
import { FeedRoutes } from './routes/feeds/handler.ts'
import { IndexRoutes } from './routes/index/handler.tsx'
import { LinkImageRoutes } from './routes/link-images/handler.ts'
import { PostRoutes } from './routes/post/handler.tsx'
import { SiteFileRoutes } from './routes/site-files/handler.ts'
import { SubscribeRoutes } from './routes/subscribe/handler.tsx'

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

// The services integrations use, at fixed addresses (Cloudflare's for Turnstile, Resend's for
// email), fetched with PublicNetwork's fetch, which the tests replace. They're not addresses
// anyone types, so they don't need the checks link previews' fetches do.
const IntegrationHttp = FetchHttpClient.layer.pipe(
  Layer.provide(
    Layer.effect(
      FetchHttpClient.Fetch,
      Effect.map(PublicNetwork, (network) =>
        Object.assign(
          (input: string | URL | Request, init?: BunFetchRequestInit) =>
            network.fetch(new URL(input instanceof Request ? input.url : input), init ?? {}),
          { preconnect: fetch.preconnect },
        ),
      ),
    ),
  ),
)

const TurnstileLive = Turnstile.layer.pipe(
  Layer.provide([SiteConfigQueriesLive, Secrets.layer, IntegrationHttp]),
)
const EmailLive = Email.layer.pipe(
  Layer.provide([MigratedDatabase, SiteConfigQueriesLive, Secrets.layer, IntegrationHttp]),
)

// Requires AppConfig and PublicNetwork. SQL and media services are exposed for seeding and file
// queries; the remaining outputs are the APIs used by routes and the server's shutdown hook.
export const AppServices = Layer.mergeAll(
  MigratedDatabase,
  MediaStorage.layer,
  Images.layer,
  PostQueriesLive,
  SiteConfigQueriesLive,
  Assets.layer,
  Secrets.layer,
  AdminAuth.layer.pipe(Layer.provide(MigratedDatabase)),
  PostCommands.layer.pipe(Layer.provide([MigratedDatabase, MediaStorage.layer, Images.layer])),
  SiteConfigCommands.layer.pipe(
    Layer.provide([
      MigratedDatabase,
      MediaStorage.layer,
      Images.layer,
      SiteConfigQueriesLive,
      Secrets.layer,
      EmailLive,
      TurnstileLive,
    ]),
  ),
  TurnstileLive,
  EmailLive,
  UserCommands.layer.pipe(
    Layer.provide([MigratedDatabase, SiteConfigQueriesLive, EmailLive, TurnstileLive]),
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

// ServerLive serves these routes; tests drive them through an in-memory web handler.
export const AppRoutes = Layer.mergeAll(
  IndexRoutes,
  PostRoutes,
  FeedRoutes,
  SiteFileRoutes,
  LinkImageRoutes,
  AssetRoutes,
  SubscribeRoutes,
  AdminLoginRoutes,
  AdminIndexRoutes,
  PostListRoutes,
  ComposeRoutes,
  BrandingRoutes,
  IntegrationRoutes,
  SubscriberRoutes,
  DevIndexRoutes,
  DesignRoutes,
  DevEmailRoutes,
  AppMiddleware,
)

// The app on AppConfig's port. Retains the app services and listener for startup logging and the
// browser fixture's address.
export const ServerLive = Layer.unwrap(
  Effect.gen(function* () {
    let { port, hostname } = yield* AppConfig
    return HttpRouter.serve(AppRoutes, { disableLogger: true }).pipe(
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
