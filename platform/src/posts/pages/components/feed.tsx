import type { Html } from '#jsx/jsx-runtime'

import { routes } from '../../../routes.ts'
import { Caption, PostMedia, PostMeta } from '../../components/post.tsx'
import type { LinkPreview, Post } from '../../presentation.ts'

export interface FeedItem {
  readonly post: Post
  readonly preview?: LinkPreview | undefined
}

// A timeline of posts modeled on an X profile, minus the avatar and name: each post shows its
// date, time, city, and a share button, then its caption, then its media, with a line between
// posts. Clicking anywhere on a post opens its page.
export function Feed(props: { items: readonly FeedItem[]; siteUrl: string }): Html {
  return (
    <section aria-label="Posts" class="feed">
      {props.items.map(({ post, preview }, index) => (
        <article class="feed-post">
          {/* Covers the whole post so a click anywhere opens it. Hidden from keyboard and screen
              readers, which use the timestamp link instead. */}
          <a href={routes.post(post.id)} aria-hidden="true" tabindex="-1" class="post-link" />
          <PostMeta post={post} siteUrl={props.siteUrl} />
          {post.captionHtml ? <Caption html={post.captionHtml} /> : null}
          <PostMedia post={post} preview={preview} priority={index === 0} />
        </article>
      ))}
    </section>
  )
}
