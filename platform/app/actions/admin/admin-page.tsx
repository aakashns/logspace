import type { Handle } from 'remix/component'
import { css } from 'remix/component'

import type { Post } from '../../data/posts.ts'
import { captionText } from '../../lib/caption.ts'
import { routes } from '../../routes.ts'
import { formatPostDate } from '../../ui/post.tsx'
import { navButtonStyle } from '../../ui/public/nav-button.ts'
import { Tooltip } from '../../ui/public/tooltip.tsx'
import {
  actionsStyle,
  buttonStyle,
  errorStyle,
  inputStyle,
  mutedStyle,
  pageStyle,
  secondaryButtonStyle,
  titleStyle,
} from './styles.ts'

export function AdminLoginPage(handle: Handle<{ error?: string; enabled: boolean }>) {
  return () => {
    let { error, enabled } = handle.props
    return (
      <section mix={pageStyle}>
        <h1 mix={titleStyle}>Manage Site</h1>
        {enabled ? (
          <form method="post" action={routes.admin.authenticate.href()} mix={formStyle}>
            <label for="password">Admin Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? 'password-error' : undefined}
              mix={inputStyle}
            />
            {error ? (
              <p id="password-error" role="alert" mix={errorStyle}>
                {error}
              </p>
            ) : null}
            <button type="submit" mix={buttonStyle}>
              Log in
            </button>
          </form>
        ) : (
          <p>
            Managing the site is switched off. Set <code>ADMIN_PASSWORD</code> and{' '}
            <code>AUTH_SESSION_SECRET</code> (each at least 16 characters) and restart the server.
          </p>
        )}
      </section>
    )
  }
}

export function AdminPage(handle: Handle<{ posts: Post[] }>) {
  return () => {
    let { posts } = handle.props
    return (
      <section mix={pageStyle}>
        <div mix={headingStyle}>
          <h1 mix={titleStyle}>Manage Site</h1>
          <div mix={actionsStyle}>
            <a href={routes.admin.config.index.href()} mix={secondaryButtonStyle}>
              Configure
            </a>
            <a href={routes.admin.posts.new.index.href()} mix={buttonStyle}>
              New Post
            </a>
          </div>
        </div>
        {posts.length === 0 ? (
          <p mix={mutedStyle}>No posts yet.</p>
        ) : (
          <ul mix={listStyle}>
            {posts.map((post) => (
              <li key={post.id} mix={itemStyle}>
                <p mix={mutedStyle}>
                  <a href={routes.posts.show.href({ id: post.id })}>
                    <time dateTime={post.date}>{formatPostDate(post.date)}</time>
                  </a>
                  {` · ${post.type} · `}
                  <a href={routes.admin.posts.edit.index.href({ id: post.id })}>Edit</a>
                </p>
                <p mix={summaryStyle}>{summarize(post)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  }
}

// For the navbar on pages behind the admin login.
export function AdminLogoutButton() {
  return () => (
    <form method="post" action={routes.admin.logout.href()}>
      <Tooltip label="Log out">
        <button type="submit" aria-label="Log out" mix={navButtonStyle}>
          <LogoutIcon />
        </button>
      </Tooltip>
    </form>
  )
}

// An arrow leaving a door frame.
function LogoutIcon() {
  return () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M9.5 20.5H5.5A1.5 1.5 0 0 1 4 19V5A1.5 1.5 0 0 1 5.5 3.5H9.5M15.5 16.5L20 12L15.5 7.5M20 12H9"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

// One line describing a post: an article's title, else the caption's first line, else its media.
function summarize(post: Post) {
  if (post.type === 'article') return post.article.title
  let firstLine = post.caption ? captionText(post.caption).trim().split('\n')[0] : ''
  if (firstLine) return firstLine
  if (post.type === 'photos') {
    return post.photos.length === 1 ? '1 photo' : `${post.photos.length} photos`
  }
  return 'Video'
}

const formStyle = css({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '0.5rem',
  maxWidth: '20rem',
  '& button': { marginTop: '0.5rem' },
})

const headingStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '1rem',
})

const listStyle = css({
  listStyle: 'none',
  borderTop: '1px solid var(--border)',
})

const itemStyle = css({
  paddingBlock: '0.75rem',
  borderBottom: '1px solid var(--border)',
})

const summaryStyle = css({
  marginTop: '0.25rem',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})
