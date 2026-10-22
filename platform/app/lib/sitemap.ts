import type { Post } from '../data/posts/presentation.ts'
import { routes } from '../routes.ts'
import { getSiteConfig } from '../data/config.ts'
import { escapeXml } from './xml.ts'

// sitemap.xml listing the home page and every post, each with the date it last changed.
export function createSitemap(posts: Post[]) {
  let { siteUrl } = getSiteConfig()
  let urls = [
    { path: routes.home.href(), lastmod: posts[0]?.date },
    ...posts.map((post) => ({ path: routes.posts.show.href({ id: post.id }), lastmod: post.date })),
  ]
  let entries = urls.map(
    ({ path, lastmod }) =>
      `  <url>\n    <loc>${escapeXml(siteUrl + path)}</loc>\n` +
      (lastmod ? `    <lastmod>${escapeXml(lastmod)}</lastmod>\n` : '') +
      '  </url>',
  )
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `${entries.join('\n')}\n</urlset>\n`
  )
}
