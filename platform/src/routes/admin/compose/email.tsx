// The email telling a subscriber about a new post (see ../../../data/posts/commands.ts): the post
// as its page shows it, under the site's logo, with the app's styles, and in plain text, and the
// link to unsubscribe.
import { raw } from '#jsx/jsx-runtime'

import { DOCUMENT_STYLES } from '../../../components/document.tsx'
import { Caption, PostMedia } from '../../../components/post.tsx'
import { SiteLogo } from '../../../components/site-logo.tsx'
import { stylesheet } from '../../../components/stylesheet.ts'
import type { NewPostEmail } from '../../../data/posts/commands.ts'
import { captionText } from '../../../data/posts/caption.ts'
import { clamp, formatPostDate } from '../../../data/posts/format.ts'
import { summarizePost } from '../../../data/posts/presentation.ts'
import { urls } from '../../../lib/urls.ts'
import { POST_PAGE_STYLES } from '../../post/page.tsx'
import css from './email.css' with { type: 'text' }

// Each custom property the theme sets with light-dark(<light>, <dark>) (all its colors), which
// email apps don't all know, set to <light>, and to <dark> while prefers-color-scheme is dark.
// Unlayered, the dark ones win over the theme's layer. The stylesheet is minified, so there's no
// space around the comma.
const LIGHT_DARK = /(--[\w-]+):light-dark\(((?:[^(),]|\([^()]*\))+),((?:[^(),]|\([^()]*\))+)\)/g
function preferColorScheme(styles: string): string {
  let dark: string[] = []
  let light = styles.replace(LIGHT_DARK, (_, name: string, light: string, darkValue: string) => {
    dark.push(`${name}:${darkValue}`)
    return `${name}:${light}`
  })
  return `${light}@media (prefers-color-scheme:dark){:root{${dark.join(';')}}}`
}

const EMAIL_STYLES = preferColorScheme(DOCUMENT_STYLES + POST_PAGE_STYLES + stylesheet(css))

export const newPostEmail: NewPostEmail = (post, site, unsubscribeUrl) => {
  let postUrl = site.siteUrl + urls.post(post.id)
  let subject = clamp(summarizePost(post), 80)
  let html = (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Apple Mail shows it in dark mode as its styles say, rather than darkening it. */}
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <title>{subject}</title>
        <style>{raw(EMAIL_STYLES)}</style>
      </head>
      <body>
        <header class="navbar">
          <div class="navbar-content">
            <a href={site.siteUrl} class="navbar-title">
              <SiteLogo site={site} height="1.2rem" origin={site.siteUrl} />
            </a>
          </div>
        </header>
        <main>
          <article class="post-page">
            <header class="post-meta">
              <p>
                <a href={postUrl} class="permalink">
                  <time datetime={post.date}>{formatPostDate(post.date)}</time>
                </a>
                {post.city ? ` · ${post.city}` : null}
              </p>
            </header>
            {post.captionHtml ? <Caption html={post.captionHtml} /> : null}
            <PostMedia post={post} full priority />
          </article>
          <footer class="email-footer">
            <p>
              You’re subscribed to <a href={site.siteUrl}>{site.siteTitle}</a>.{' '}
              <a href={unsubscribeUrl}>Unsubscribe</a>
            </p>
          </footer>
        </main>
      </body>
    </html>
  )
  return {
    subject,
    text:
      `${post.caption ? captionText(post.caption) : summarizePost(post)}\n\n${postUrl}\n\n` +
      `You’re subscribed to ${site.siteTitle} (${site.siteUrl}).\n` +
      `To unsubscribe: ${unsubscribeUrl}\n`,
    html: `<!DOCTYPE html>${html.value}`,
  }
}
