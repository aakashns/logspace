import type { Html } from '#jsx/jsx-runtime'

import { routes } from '../../../routes.ts'
import { formatPostDate } from '../../format.ts'
import { summarizePost, type Post } from '../../presentation.ts'

// /admin: links to configure the site and write a post, and every post, newest first.
export function PostsPage(props: { posts: readonly Post[] }): Html {
  let { posts } = props
  return (
    <section class="admin-page">
      <div class="admin-heading">
        <h1 class="page-title">Manage Site</h1>
        <div class="actions">
          <a href={routes.admin.config()} class="secondary-button">
            Configure
          </a>
          <a href={routes.admin.newPost()} class="button">
            New Post
          </a>
        </div>
      </div>
      {posts.length === 0 ? (
        <p class="muted">No posts yet.</p>
      ) : (
        <ul class="post-list">
          {posts.map((post) => (
            <li>
              <p class="muted">
                <a href={routes.post(post.id)}>
                  <time datetime={post.date}>{formatPostDate(post.date)}</time>
                </a>
                {` · ${post.type} · `}
                <a href={routes.admin.editPost(post.id)}>Edit</a>
              </p>
              <p class="post-summary">{summarizePost(post)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
