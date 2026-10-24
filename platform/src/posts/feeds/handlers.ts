// sitemap.xml and rss.xml.
import { Effect } from 'effect'
import { HttpRouter } from 'effect/http'

import { textFileResponse } from '../../http/responses.ts'
import { configuredSite } from '../../site/queries.ts'
import { PostQueries } from '../queries.ts'
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

export const FeedRoutes = HttpRouter.addAll([
  HttpRouter.route('GET', '/sitemap.xml', sitemap),
  HttpRouter.route('GET', '/rss.xml', rss),
])
