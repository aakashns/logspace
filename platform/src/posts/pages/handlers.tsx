// The home page, a post's page, and a post's files.
import { Effect } from 'effect'
import { HttpRouter } from 'effect/http'

import { Document } from '../../components/document.tsx'
import { pageContext, pageResponse, param, requestUrl } from '../../http/pages.ts'
import { fileResponse, IMMUTABLE, notFound } from '../../http/responses.ts'
import { routes } from '../../routes.ts'
import { configuredSite } from '../../site/queries.ts'
import { getBannerSrcset, getSiteImageHref } from '../../site/site-images.ts'
import { LinkPreviews } from '../link-previews/link-previews.ts'
import { PostMedia } from '../media.ts'
import { getPostMeta, getPriorityImage } from '../presentation.ts'
import { PostQueries } from '../queries.ts'
import { BANNER_IMAGE_SIZES, HomePage } from './components/home.tsx'
import { PostNotFound, PostPage } from './components/post-page.tsx'

const home = Effect.gen(function* () {
  let page = yield* pageContext
  let site = yield* configuredSite
  let posts = yield* (yield* PostQueries).all
  let previews = yield* LinkPreviews
  let { bannerImage } = site
  let bannerSrcset = bannerImage && getBannerSrcset(bannerImage)
  let items = yield* Effect.forEach(posts, (post) =>
    Effect.map(previews.forPost(post), (preview) => ({ post, preview })),
  )
  return pageResponse(
    page,
    <Document
      page={page}
      meta={{ path: routes.home() }}
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
      <HomePage site={site} items={items} />
    </Document>,
  )
})

const showPost = Effect.gen(function* () {
  let page = yield* pageContext
  let post = yield* (yield* PostQueries).find(yield* param('id'))
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
  let site = yield* configuredSite
  let preview = yield* (yield* LinkPreviews).forPost(post)
  return pageResponse(
    page,
    <Document page={page} meta={getPostMeta(post)} preloadImage={getPriorityImage(post, true)}>
      <PostPage post={post} siteUrl={site.siteUrl} preview={preview} />
    </Document>,
  )
})

// One of a post's files, served only once the post is published. Pages link to images with `v`,
// a hash of the image, and to resized copies with `w` as well (see ../presentation.ts).
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

export const PageRoutes = HttpRouter.addAll([
  HttpRouter.route('GET', '/', home),
  HttpRouter.route('GET', '/posts/:id', showPost),
  HttpRouter.route('GET', '/posts/:id/:file', postFile),
])
