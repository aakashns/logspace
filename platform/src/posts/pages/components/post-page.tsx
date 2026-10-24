import type { Html } from '#jsx/jsx-runtime'

import { routes } from '../../../routes.ts'
import { Caption, PostMedia, PostMeta } from '../../components/post.tsx'
import type { LinkPreview, Post } from '../../presentation.ts'

// A post on its own page: its caption, with every photo at full size.
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
        <a href={routes.home()} class="text-link">
          See all posts
        </a>
      </p>
    </section>
  )
}
