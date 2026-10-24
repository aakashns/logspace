// The files for crawlers and feed readers: sitemap.xml, robots.txt, and rss.xml.
import { Effect } from 'effect'
import { HttpRouter } from 'effect/http'

import { PostQueries } from '../../data/posts/queries.ts'
import { configuredSite } from '../../data/site/queries.ts'
import { textFileResponse } from '../../lib/http/responses.ts'
import { urls } from '../../lib/urls.ts'
import { createRssFeed, createSitemap } from './feeds.ts'

// How many of the newest posts the RSS feed has.
const FEED_LENGTH = 50

const sitemap = Effect.gen(function* () {
  let posts = yield* (yield* PostQueries).all
  return textFileResponse(createSitemap(posts, yield* configuredSite), 'application/xml')
})

const rss = Effect.gen(function* () {
  let posts = (yield* (yield* PostQueries).all).slice(0, FEED_LENGTH)
  return textFileResponse(createRssFeed(posts, yield* configuredSite), 'application/rss+xml')
})

const robots = Effect.map(configuredSite, ({ siteUrl }) =>
  textFileResponse(
    `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}${urls.sitemap()}\n`,
    'text/plain',
  ),
)

export const FeedRoutes = HttpRouter.addAll([
  HttpRouter.route('GET', '/sitemap.xml', sitemap),
  HttpRouter.route('GET', '/robots.txt', robots),
  HttpRouter.route('GET', '/rss.xml', rss),
])
