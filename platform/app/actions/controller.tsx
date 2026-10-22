import { createFileResponse } from 'remix/response/file'
import { createController } from 'remix/router'

import { assets } from '../assets.ts'
import { getArticleHtml } from '../data/article.ts'
import { getSavedSiteConfig, getSiteConfig } from '../data/config.ts'
import { getPostLinkPreview } from '../data/link-previews.ts'
import { getPosts } from '../data/posts/store.ts'
import { getIconColor, getIconHref, getSiteFile } from '../data/site-images.ts'
import { FEED_LENGTH } from '../lib/constants.ts'
import { createRssFeed } from '../lib/rss.ts'
import { createSitemap } from '../lib/sitemap.ts'
import { getTheme } from '../lib/theme.ts'
import { routes } from '../routes.ts'
import { getPriorityImage } from '../ui/post.tsx'
import { Document } from './document.tsx'
import { HomePage } from './home-page.tsx'

export default createController(routes, {
  actions: {
    async assets(context) {
      return (await assets.fetch(context.request)) ?? new Response('Not Found', { status: 404 })
    },
    async home(context) {
      let posts = await getPosts()
      let items = await Promise.all(
        posts.map(async (post) => ({ post, preview: await getPostLinkPreview(post) })),
      )
      return context.render(
        <Document
          theme={getTheme(context.request)}
          meta={{ path: routes.home.href() }}
          preloadImage={posts[0] && getPriorityImage(posts[0])}
        >
          <HomePage items={items} />
        </Document>,
      )
    },
    async sitemap() {
      return new Response(createSitemap(await getPosts()), {
        headers: { 'Content-Type': 'application/xml; charset=utf-8' },
      })
    },
    robots() {
      let sitemap = getSiteConfig().siteUrl + routes.sitemap.href()
      return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${sitemap}\n`, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    },
    // Named after the site, for browsers that install it as an app, in its icon's color.
    async manifest() {
      let site = getSiteConfig()
      let color = await getIconColor(site)
      let icon = (file: string, size: number, purpose?: string) => ({
        src: getIconHref(site, file),
        sizes: `${size}x${size}`,
        type: 'image/png',
        purpose,
      })
      let manifest = {
        name: site.siteTitle,
        start_url: '/',
        display: 'browser',
        background_color: color,
        theme_color: color,
        icons: [
          icon('icon-192.png', 192),
          icon('icon-512.png', 512),
          icon('icon-maskable-512.png', 512, 'maskable'),
        ],
      }
      return new Response(JSON.stringify(manifest, null, 2), {
        headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' },
      })
    },
    favicon(context) {
      return serveSiteFile('favicon.ico', context.request)
    },
    appleTouchIcon(context) {
      return serveSiteFile('apple-touch-icon.png', context.request)
    },
    siteFile(context) {
      let { file } = context.params
      // These two are served at the root.
      if (file === 'favicon.ico' || file === 'apple-touch-icon.png') return notFound()
      return serveSiteFile(file, context.request)
    },
    async rss() {
      let posts = (await getPosts()).slice(0, FEED_LENGTH)
      let items = await Promise.all(
        posts.map(async (post) => ({
          post,
          articleHtml: post.type === 'article' ? await getArticleHtml(post) : undefined,
        })),
      )
      return new Response(createRssFeed(items), {
        headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
      })
    },
  },
})

// One of the site's image files. A URL with its current version is cached for a year, since a new
// upload gets a new one; anything else for an hour. They're served before the site is configured
// too, for the admin pages.
async function serveSiteFile(name: string, request: Request) {
  let found = await getSiteFile(name, getSavedSiteConfig())
  if (!found) return notFound()
  let current = new URL(request.url).searchParams.get('v') === found.version
  return createFileResponse(found.file, request, {
    cacheControl: current ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
  })
}

function notFound() {
  return new Response('Not Found', { status: 404 })
}
