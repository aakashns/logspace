// A post's page, and its files.
import { Effect } from 'effect'
import { HttpRouter } from 'effect/http'

import { Document } from '../../components/document.tsx'
import { LinkPreviews } from '../../data/link-previews/link-previews.ts'
import { PostMedia } from '../../data/posts/media.ts'
import { getPostMeta, getPriorityImage } from '../../data/posts/presentation.ts'
import { PostQueries } from '../../data/posts/queries.ts'
import { configuredSite } from '../../data/site/queries.ts'
import { pageContext, pageResponse, param, requestUrl } from '../../lib/http/pages.ts'
import { fileResponse, IMMUTABLE, notFound } from '../../lib/http/responses.ts'
import { PostNotFound, PostPage } from './page.tsx'

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
// a hash of the image, and to resized copies with `w` as well (see ../../data/posts/presentation.ts).
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

export const PostRoutes = HttpRouter.addAll([
  HttpRouter.route('GET', '/posts/:id', showPost),
  HttpRouter.route('GET', '/posts/:id/:file', postFile),
])
