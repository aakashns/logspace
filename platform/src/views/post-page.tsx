import { raw, type Html } from '#jsx/jsx-runtime'

import { FULL_WIDTH_IMAGE_SIZES } from '../domain/constants.ts'
import type { Post } from '../domain/presentation.ts'
import type { LinkPreview } from '../queries/link-previews.ts'
import { routes } from '../routes.ts'
import { Caption, PostMedia, PostMeta } from './post.tsx'

// A post on its own page. Articles show their title, summary, cover, and body; other posts show
// their caption with every photo at full size.
export function PostPage(props: {
  post: Post
  siteUrl: string
  preview?: LinkPreview | undefined
  articleHtml?: string | undefined
}): Html {
  let { post, siteUrl, preview, articleHtml } = props

  if (post.type === 'article') {
    let { title, summary, cover } = post.article
    return (
      <article class="post-page">
        <PostMeta post={post} siteUrl={siteUrl} />
        <h1 class="page-title">{title}</h1>
        <p class="article-summary">{summary}</p>
        {cover ? (
          <img
            src={cover.src}
            srcset={cover.srcset}
            sizes={cover.srcset ? FULL_WIDTH_IMAGE_SIZES : undefined}
            alt={cover.alt}
            width={cover.width}
            height={cover.height}
            fetchpriority="high"
            class="article-cover"
          />
        ) : null}
        {/* HTML made from what the author wrote, which Datastar ignores. */}
        <div class="prose" data-ignore>
          {raw(articleHtml ?? '')}
        </div>
      </article>
    )
  }

  return (
    <article class="post-page">
      <PostMeta post={post} siteUrl={siteUrl} />
      {post.captionHtml ? <Caption html={post.captionHtml} /> : null}
      <PostMedia post={post} preview={preview} full priority />
    </article>
  )
}

export function PostNotFound(): Html {
  return (
    <section class="post-page">
      <h1 class="page-title">Post not found</h1>
      <p>
        There’s no post at this address.{' '}
        <a href={routes.home()} class="prose-link">
          See all posts
        </a>
      </p>
    </section>
  )
}
