// The public pages and files: the home page, a post's page and files, the feeds, the site's icons
// and images, and the assets every page loads.
import { Effect } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/http'

import { FEED_LENGTH } from '../domain/constants.ts'
import { createRobotsTxt, createRssFeed, createSitemap, type FeedItem } from '../domain/feeds.ts'
import { getPostMeta, getPriorityImage } from '../domain/presentation.ts'
import { isSiteConfigured, type SiteConfig } from '../domain/site.ts'
import { LinkPreviews } from '../queries/link-previews.ts'
import { PostMedia } from '../queries/post-media.ts'
import { PostQueries } from '../queries/posts.ts'
import { SiteConfigQueries } from '../queries/site-config.ts'
import { getIconHref, SiteFiles } from '../queries/site-files.ts'
import { routes } from '../routes.ts'
import { Document } from '../views/document.tsx'
import { HomePage } from '../views/home.tsx'
import { PostNotFound, PostPage } from '../views/post-page.tsx'
import { Assets } from './assets.ts'
import { pageContext, pageResponse, param, requestUrl } from './pages.ts'
import { fileResponse, IMMUTABLE, notFound } from './responses.ts'

// The site's settings, for what's only served once they're saved (see the gate in
// middleware.ts).
const siteConfig = Effect.flatMap(SiteConfigQueries, (queries) => queries.saved).pipe(
  Effect.flatMap((saved) =>
    isSiteConfigured(saved)
      ? Effect.succeed<SiteConfig>(saved)
      : Effect.die('The site isn’t configured yet'),
  ),
)

const home = Effect.gen(function* () {
  let page = yield* pageContext
  let site = yield* siteConfig
  let posts = yield* (yield* PostQueries).all
  let previews = yield* LinkPreviews
  let items = yield* Effect.forEach(posts, (post) =>
    Effect.map(previews.forPost(post), (preview) => ({ post, preview })),
  )
  return pageResponse(
    page,
    <Document
      page={page}
      meta={{ path: routes.home() }}
      preloadImage={posts[0] && getPriorityImage(posts[0])}
    >
      <HomePage site={site} items={items} />
    </Document>,
  )
})

const showPost = Effect.gen(function* () {
  let page = yield* pageContext
  let posts = yield* PostQueries
  let post = yield* posts.find(yield* param('id'))
  if (!post) {
    let { pathname } = yield* requestUrl
    return pageResponse(
      page,
      <Document page={page} meta={{ path: pathname, title: 'Post not found', noindex: true }}>
        <PostNotFound />
      </Document>,
      { status: 404 },
    )
  }
  let site = yield* siteConfig
  let preview = yield* (yield* LinkPreviews).forPost(post)
  let articleHtml = post.type === 'article' ? yield* posts.articleHtml(post) : undefined
  return pageResponse(
    page,
    <Document page={page} meta={getPostMeta(post)} preloadImage={getPriorityImage(post, true)}>
      <PostPage post={post} siteUrl={site.siteUrl} preview={preview} articleHtml={articleHtml} />
    </Document>,
  )
})

// One of a post's files, served only once the post is published. Pages link to images with `v`,
// a hash of the image, and to resized copies with `w` as well (see domain/presentation.ts).
// Those URLs change when the image does, so browsers can keep them for good. Other URLs, and ones
// with an old `v`, are revalidated after an hour, so replacing a file shows up soon.
const postFile = Effect.gen(function* () {
  let id = yield* param('id')
  let name = yield* param('file')
  let { searchParams } = yield* requestUrl
  let version = searchParams.get('v')
  let width = searchParams.get('w')
  let media = yield* PostMedia

  if (version !== null && width !== null) {
    let variant = yield* media.resized(id, name, Number(width), version)
    return variant ? yield* fileResponse(variant, IMMUTABLE) : notFound()
  }
  let file = yield* media.original(id, name)
  if (!file) return notFound()
  let current =
    version !== null && (yield* (yield* PostQueries).imageInfo(id, name))?.version === version
  return yield* fileResponse(file, current ? IMMUTABLE : 'public, max-age=3600')
})

const feedResponse = (body: string, type: string) =>
  HttpServerResponse.text(body, { contentType: `${type}; charset=utf-8` })

const sitemap = Effect.gen(function* () {
  let posts = yield* (yield* PostQueries).all
  return feedResponse(createSitemap(posts, yield* siteConfig), 'application/xml')
})

const rss = Effect.gen(function* () {
  let queries = yield* PostQueries
  let posts = (yield* queries.all).slice(0, FEED_LENGTH)
  let items = yield* Effect.forEach(posts, (post): Effect.Effect<FeedItem> =>
    post.type === 'article'
      ? Effect.map(queries.articleHtml(post), (articleHtml) => ({ post, articleHtml }))
      : Effect.succeed({ post }),
  )
  return feedResponse(createRssFeed(items, yield* siteConfig), 'application/rss+xml')
})

const robots = Effect.map(siteConfig, (site) => feedResponse(createRobotsTxt(site), 'text/plain'))

// Named after the site, for browsers that install it as an app, in its icon's color.
const manifest = Effect.gen(function* () {
  let site = yield* siteConfig
  let color = yield* (yield* SiteFiles).iconColor(site)
  let icon = (file: string, size: number, purpose?: string) => ({
    src: getIconHref(site, file),
    sizes: `${size}x${size}`,
    type: 'image/png',
    purpose,
  })
  let manifest = {
    name: site.siteTitle,
    start_url: '/',
    display: 'browser',
    background_color: color,
    theme_color: color,
    icons: [
      icon('icon-192.png', 192),
      icon('icon-512.png', 512),
      icon('icon-maskable-512.png', 512, 'maskable'),
    ],
  }
  return feedResponse(JSON.stringify(manifest, null, 2), 'application/manifest+json')
})

// One of the site's image files. A URL with its current version is cached for a year, since a
// new upload gets a new one; anything else for an hour. They're served before the site is
// configured too, for the admin pages.
const siteFile = (name: string) =>
  Effect.gen(function* () {
    let saved = yield* (yield* SiteConfigQueries).saved
    let found = yield* (yield* SiteFiles).get(name, saved)
    if (!found) return notFound()
    let current = (yield* requestUrl).searchParams.get('v') === found.version
    return yield* fileResponse(found.file, current ? IMMUTABLE : 'public, max-age=3600')
  })

// Datastar and the fonts, which never change at a URL.
const asset = Effect.gen(function* () {
  let { pathname } = yield* requestUrl
  let file = (yield* Assets).files.get(pathname)
  if (!file) return notFound()
  return HttpServerResponse.uint8Array(file.bytes, {
    contentType: file.type,
    headers: { 'Cache-Control': IMMUTABLE },
  })
})

export const PublicRoutes = HttpRouter.addAll([
  HttpRouter.route('GET', '/', home),
  HttpRouter.route('GET', '/posts/:id', showPost),
  HttpRouter.route('GET', '/posts/:id/:file', postFile),
  HttpRouter.route('GET', '/sitemap.xml', sitemap),
  HttpRouter.route('GET', '/rss.xml', rss),
  HttpRouter.route('GET', '/robots.txt', robots),
  HttpRouter.route('GET', '/site.webmanifest', manifest),
  HttpRouter.route('GET', '/favicon.ico', siteFile('favicon.ico')),
  HttpRouter.route('GET', '/apple-touch-icon.png', siteFile('apple-touch-icon.png')),
  HttpRouter.route(
    'GET',
    '/site/:file',
    Effect.flatMap(param('file'), (name) =>
      // These two are served at the root.
      name === 'favicon.ico' || name === 'apple-touch-icon.png'
        ? Effect.succeed(notFound())
        : siteFile(name),
    ),
  ),
  HttpRouter.route('GET', '/assets/:file', asset),
  HttpRouter.route('GET', '/fonts/:file', asset),
])
