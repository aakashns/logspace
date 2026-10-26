// The home page: the site's introduction, and every post, newest first.
import { Effect } from 'effect'
import { HttpRouter } from 'effect/http'

import { Document } from '../../components/document.tsx'
import { LinkPreviews } from '../../data/link-previews/link-previews.ts'
import { getPriorityImage } from '../../data/posts/presentation.ts'
import { PostQueries } from '../../data/posts/queries.ts'
import { PushDelivery } from '../../data/push/delivery.ts'
import { configuredSite } from '../../data/site/queries.ts'
import { getBannerSrcset, getSiteImageHref } from '../../data/site/site-images.ts'
import { subscriptionsStatus } from '../../data/site/subscriptions.ts'
import { pageContext, pageResponse } from '../../lib/http/pages.ts'
import { urls } from '../../lib/urls.ts'
import { BANNER_IMAGE_SIZES, HOME_PAGE_STYLES, HomePage } from './page.tsx'

const home = Effect.gen(function* () {
  let page = yield* pageContext
  let site = yield* configuredSite
  let posts = yield* (yield* PostQueries).all
  let previews = yield* LinkPreviews
  let subscriptions = yield* subscriptionsStatus
  let push = yield* (yield* PushDelivery).status
  let { bannerImage } = site
  let bannerSrcset = bannerImage && getBannerSrcset(bannerImage)
  let items = yield* Effect.forEach(posts, (post) =>
    Effect.map(previews.forPost(post), (preview) => ({ post, preview })),
  )
  let pushPublicKey = push._tag === 'On' ? push.publicKey : undefined
  return pageResponse(
    page,
    <Document
      page={page}
      meta={{ path: urls.home() }}
      styles={HOME_PAGE_STYLES}
      pushNotifications={pushPublicKey !== undefined}
      // The banner, when there's one, is at the top, above the first post.
      preloadImage={
        bannerImage
          ? {
              href: getSiteImageHref(bannerImage),
              srcset: bannerSrcset || undefined,
              sizes: bannerSrcset ? BANNER_IMAGE_SIZES : undefined,
            }
          : posts[0] && getPriorityImage(posts[0])
      }
    >
      <HomePage
        site={site}
        items={items}
        subscribe={subscriptions._tag === 'Open'}
        pushPublicKey={pushPublicKey}
      />
    </Document>,
    { pushNotifications: pushPublicKey !== undefined },
  )
})

export const IndexRoutes = HttpRouter.addAll([HttpRouter.route('GET', '/', home)])
