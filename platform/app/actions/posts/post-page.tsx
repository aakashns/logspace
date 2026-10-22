import type { Handle } from 'remix/component'
import { css, unsafeHTML } from 'remix/component'

import type { LinkPreview } from '../../data/link-previews.ts'
import type { Photo, Post } from '../../data/posts.ts'
import { captionText } from '../../lib/caption.ts'
import { FULL_WIDTH_IMAGE_SIZES } from '../../lib/constants.ts'
import type { PageMeta } from '../../lib/page-meta.ts'
import { routes } from '../../routes.ts'
import { Caption, PostMedia, PostMeta } from '../../ui/post.tsx'

// A post on its own page. Articles show their title, summary, cover, and body; other posts show
// their caption with every photo at full size.
export function PostPage(
  handle: Handle<{ post: Post; preview?: LinkPreview; articleHtml?: string }>,
) {
  return () => {
    let { post, preview, articleHtml } = handle.props

    if (post.type === 'article') {
      let { title, summary, cover } = post.article
      return (
        <article mix={pageStyle}>
          <PostMeta post={post} />
          <h1 mix={titleStyle}>{title}</h1>
          <p mix={summaryStyle}>{summary}</p>
          {cover ? (
            <img
              src={cover.src}
              srcset={cover.srcset}
              sizes={cover.srcset ? FULL_WIDTH_IMAGE_SIZES : undefined}
              alt={cover.alt}
              width={cover.width}
              height={cover.height}
              fetchpriority="high"
              mix={coverStyle}
            />
          ) : null}
          <div mix={proseStyle} innerHTML={unsafeHTML(articleHtml ?? '')} />
        </article>
      )
    }

    return (
      <article mix={pageStyle}>
        <PostMeta post={post} />
        {post.caption ? <Caption text={post.caption} /> : null}
        <PostMedia post={post} preview={preview} full priority />
      </article>
    )
  }
}

export function PostNotFound() {
  return () => (
    <section mix={pageStyle}>
      <h1 mix={titleStyle}>Post not found</h1>
      <p>
        There’s no post at this address.{' '}
        <a href={routes.home.href()} mix={proseLinkStyle}>
          See all posts
        </a>
      </p>
    </section>
  )
}

// What the post's page tells search engines and link previews: an article's title, summary, and
// cover, or for other posts the start of the caption and the first photo or the video's poster.
export function getPostMeta(post: Post): PageMeta {
  let path = routes.posts.show.href({ id: post.id })
  let text = post.caption ? captionText(post.caption).trim() : ''
  let caption = text.replace(/\s+/g, ' ')
  let firstLine = text.split('\n')[0]
  let published = {
    date: post.date,
    kind: post.type === 'article' ? ('BlogPosting' as const) : ('SocialMediaPosting' as const),
  }

  if (post.type === 'article') {
    let { title, summary, cover } = post.article
    return { path, title, description: summary, image: cover && toImage(cover), published }
  }

  let image =
    post.type === 'photos'
      ? toImage(post.photos[0])
      : post.type === 'video' && post.video.posterImage
        ? { url: post.video.posterImage, width: post.video.width, height: post.video.height }
        : undefined
  return {
    path,
    title: clamp(firstLine, 60) || 'Post',
    description: clamp(caption, 160) || undefined,
    image,
    published,
  }
}

function toImage(photo: Photo): PageMeta['image'] {
  return { url: photo.src, alt: photo.alt, width: photo.width, height: photo.height }
}

function clamp(text: string, length: number) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text
}

const pageStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
  paddingBlock: '2rem',
})

const titleStyle = css({
  fontSize: '2rem',
  lineHeight: 1.2,
})

const summaryStyle = css({
  fontSize: '1.125rem',
  lineHeight: 1.6,
  color: 'var(--muted-foreground)',
})

const coverStyle = css({
  width: '100%',
  height: 'auto',
  marginTop: '0.75rem',
  border: '1px solid var(--border)',
  borderRadius: '1rem',
  backgroundColor: 'var(--muted)',
})

const proseLinkStyle = css({
  color: 'var(--link)',
  '&:hover': { textDecoration: 'underline' },
})

// Styles for the article body, which is HTML rendered from Markdown.
const proseStyle = css({
  marginTop: '0.75rem',
  lineHeight: 1.75,
  overflowWrap: 'break-word',
  '& > * + *': { marginTop: '1.25rem' },
  '& h2': { fontSize: '1.5rem', lineHeight: 1.3, marginTop: '2.5rem' },
  '& h3': { fontSize: '1.25rem', lineHeight: 1.35, marginTop: '2rem' },
  '& :is(h2, h3) + *': { marginTop: '0.75rem' },
  '& a': { color: 'var(--link)', textDecoration: 'underline', textUnderlineOffset: '0.15em' },
  '& strong': { fontWeight: 650 },
  '& ul': { listStyle: 'disc', paddingLeft: '1.5rem' },
  '& ol': { listStyle: 'decimal', paddingLeft: '1.5rem' },
  '& li + li': { marginTop: '0.375rem' },
  '& blockquote': {
    paddingLeft: '1rem',
    borderLeft: '3px solid var(--border)',
    color: 'var(--muted-foreground)',
    fontStyle: 'italic',
  },
  '& :not(pre) > code': {
    padding: '0.125rem 0.375rem',
    borderRadius: '0.375rem',
    backgroundColor: 'var(--muted)',
    fontSize: '0.875em',
  },
  '& pre': {
    padding: '1rem',
    overflowX: 'auto',
    borderRadius: '0.75rem',
    backgroundColor: 'var(--muted)',
    fontSize: '0.875rem',
    lineHeight: 1.6,
  },
  '& hr': { borderColor: 'var(--border)', marginBlock: '2.5rem' },
  '& :is(img, video)': {
    width: '100%',
    height: 'auto',
    marginTop: '1.75rem',
    marginBottom: '0.5rem',
    border: '1px solid var(--border)',
    borderRadius: '1rem',
    backgroundColor: 'var(--muted)',
  },
  '& video': { backgroundColor: 'black' },
  '& p :is(img, video)': {
    display: 'inline',
    width: 'auto',
    margin: 0,
    border: 0,
    borderRadius: 0,
  },
})
