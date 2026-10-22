import type { Handle } from 'remix/component'
import { css } from 'remix/component'

import type { LinkPreview } from '../data/link-previews.ts'
import type { Post } from '../data/posts/presentation.ts'
import { routes } from '../routes.ts'
import { Caption, PostMedia, PostMeta } from './post.tsx'

export interface FeedItem {
  post: Post
  preview?: LinkPreview
}

// A timeline of posts modeled on an X profile, minus the avatar and name: each post shows its
// date, time, city, and a share button, then its caption, then its media, with a line between
// posts. Clicking anywhere on a post opens its page.
export function Feed(handle: Handle<{ items: FeedItem[] }>) {
  return () => (
    <section aria-label="Posts" mix={feedStyle}>
      {handle.props.items.map(({ post, preview }, index) => (
        <FeedPost key={post.id} post={post} preview={preview} priority={index === 0} />
      ))}
    </section>
  )
}

function FeedPost(handle: Handle<{ post: Post; preview?: LinkPreview; priority: boolean }>) {
  return () => {
    let { post, preview, priority } = handle.props

    return (
      <article mix={postStyle}>
        {/* Covers the whole post so a click anywhere opens it. Hidden from keyboard and screen
            readers, which use the timestamp link instead. */}
        <a
          href={routes.posts.show.href({ id: post.id })}
          aria-hidden="true"
          tabIndex={-1}
          data-post-link
          mix={postLinkStyle}
        />
        <PostMeta post={post} />
        {post.caption ? <Caption text={post.caption} /> : null}
        <PostMedia post={post} preview={preview} priority={priority} />
      </article>
    )
  }
}

// The separator lines run the full width of the content column, past its 1rem padding, like the
// lines between posts on X. One above the first post sets the feed off from the intro; there's
// none below the last.
const feedStyle = css({
  marginInline: '-1rem',
  borderTop: '1px solid var(--border)',
})

// The whole-post link sits above the post's content (including positioned bits like photo tiles),
// and links, buttons, and videos sit above it so they still work.
const postStyle = css({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
  paddingBlock: '1.5rem',
  paddingInline: '1rem',
  borderBottom: '1px solid var(--border)',
  '&:last-child': { borderBottom: 0 },
  transition: 'background-color 150ms',
  '&:has(> [data-post-link]:hover)': {
    backgroundColor: 'color-mix(in oklch, var(--foreground) 2.5%, transparent)',
  },
  '& :is(a:not([data-post-link]), button, video)': { position: 'relative', zIndex: 2 },
})

const postLinkStyle = css({
  position: 'absolute',
  inset: 0,
  zIndex: 1,
})
