import type { Html } from '#jsx/jsx-runtime'

import { Caption, POST_STYLES, PostMedia, PostMeta } from '../../components/post.tsx'
import { stylesheet } from '../../components/stylesheet.ts'
import type { LinkPreview, Post } from '../../data/posts/presentation.ts'
import { urls } from '../../lib/urls.ts'
import css from './page.css' with { type: 'text' }

// For a post's page, and the page saying there's no post.
export const POST_PAGE_STYLES = POST_STYLES + stylesheet(css)

// A post on its own page.
export function PostPage(props: {
  post: Post
  siteUrl: string
  preview?: LinkPreview | undefined
}): Html {
  let { post, siteUrl, preview } = props
  return (
    <article class="post-page">
      <PostMeta post={post} siteUrl={siteUrl} />
      {post.captionHtml ? <Caption html={post.captionHtml} /> : null}
      <PostMedia post={post} preview={preview} priority />
    </article>
  )
}

export function PostNotFound(): Html {
  return (
    <section class="post-page">
      <h1 class="page-title">Post not found</h1>
      <p>
        There’s no post at this address.{' '}
        <a href={urls.home()} class="text-link">
          See all posts
        </a>
      </p>
    </section>
  )
}
