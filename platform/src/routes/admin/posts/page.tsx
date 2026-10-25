import type { Html } from '#jsx/jsx-runtime'

import { stylesheet } from '../../../components/stylesheet.ts'
import { formatPostDate } from '../../../data/posts/format.ts'
import { summarizePost, type Post } from '../../../data/posts/presentation.ts'
import { urls } from '../../../lib/urls.ts'
import { BackLink } from '../layout.tsx'
import css from './page.css' with { type: 'text' }

export const POSTS_PAGE_STYLES = stylesheet(css)

// /admin/posts: a link to write a post, and every post, newest first, each a link to edit it.
export function PostsPage(props: { posts: readonly Post[] }): Html {
  let { posts } = props
  return (
    <section class="admin-page">
      <BackLink />
      <div class="admin-heading">
        <h1 class="page-title">Manage Posts</h1>
        <a href={urls.admin.newPost()} class="button">
          New Post
        </a>
      </div>
      {posts.length === 0 ? (
        <p class="muted">No posts yet.</p>
      ) : (
        <ul class="post-list">
          {posts.map((post) => (
            <li>
              <a href={urls.admin.editPost(post.id)} class="post-row">
                <p class="muted">
                  <time datetime={post.date}>{formatPostDate(post.date)}</time>
                  {` · ${post.type}`}
                </p>
                <p class="post-summary" data-ignore>
                  {summarizePost(post)}
                </p>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
