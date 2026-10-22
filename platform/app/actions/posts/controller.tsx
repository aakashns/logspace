import { createFileResponse } from 'remix/response/file'
import { createController } from 'remix/router'

import { getArticleHtml } from '../../data/article.ts'
import { getPostLinkPreview } from '../../data/link-previews.ts'
import {
  getPostFile,
  getPostFileKey,
  getPostImages,
  getPostImageVariant,
} from '../../data/media.ts'
import { getPost } from '../../data/posts.ts'
import { getTheme } from '../../lib/theme.ts'
import { routes } from '../../routes.ts'
import { getPriorityImage } from '../../ui/post.tsx'
import { Document } from '../document.tsx'
import { getPostMeta, PostNotFound, PostPage } from './post-page.tsx'

export default createController(routes.posts, {
  actions: {
    async show(context) {
      let theme = getTheme(context.request)
      let post = await getPost(context.params.id)
      if (!post) {
        return context.render(
          <Document
            theme={theme}
            meta={{ path: context.url.pathname, title: 'Post not found', noindex: true }}
          >
            <PostNotFound />
          </Document>,
          { status: 404 },
        )
      }

      let [preview, articleHtml] = await Promise.all([
        getPostLinkPreview(post),
        post.type === 'article' ? getArticleHtml(post) : undefined,
      ])
      return context.render(
        <Document
          theme={theme}
          meta={getPostMeta(post)}
          preloadImage={getPriorityImage(post, true)}
        >
          <PostPage post={post} preview={preview} articleHtml={articleHtml} />
        </Document>,
      )
    },

    // Files are served only for posts in the database, so files stored for a post that isn't
    // published yet stay private. The file comes from media storage (see media.ts); with the fs
    // backend it's streamed from disk, so range requests only read the bytes they ask for.
    //
    // Pages link to images with `v`, a hash of the image's contents, and to resized copies with `w`
    // as well (see resolvePost in posts.ts). Those URLs change when the image does, so browsers can
    // keep them for good. Other URLs, and ones with an old `v`, are revalidated with the ETag after
    // an hour, so replacing a file shows up soon.
    async file(context) {
      let { id, file: name } = context.params
      if (!(await getPost(id))) return notFound()
      let version = context.url.searchParams.get('v')
      let width = context.url.searchParams.get('w')

      if (version !== null && width !== null) {
        let variant = await getPostImageVariant(id, name, Number(width), version)
        if (!variant) return notFound()
        return createFileResponse(variant, context.request, { cacheControl: IMMUTABLE })
      }

      let file = await getPostFile(id, name)
      if (!file) return notFound()
      let current =
        version !== null &&
        (await getPostImages([[id, name]])).get(getPostFileKey(id, name))?.version === version
      return createFileResponse(file, context.request, {
        cacheControl: current ? IMMUTABLE : 'public, max-age=3600',
      })
    },
  },
})

const IMMUTABLE = 'public, max-age=31536000, immutable'

function notFound() {
  return new Response('Not Found', { status: 404 })
}
