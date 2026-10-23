// The files the site serves for machines: sitemap.xml, rss.xml, and robots.txt. Pure: the
// handlers in ../http/public.ts pass in the posts and the site's settings.
import { routes } from '../routes.ts'
import { getPostMeta, type Photo, type Post } from './presentation.ts'
import type { SiteConfig } from './site.ts'

// Text and attribute values in XML.
export function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

// sitemap.xml lists the home page and every post, each with the date it last changed.
export function createSitemap(posts: readonly Post[], { siteUrl }: SiteConfig): string {
  let urls = [
    { path: routes.home(), lastmod: posts[0]?.date },
    ...posts.map((post) => ({ path: routes.post(post.id), lastmod: post.date })),
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

export function createRobotsTxt({ siteUrl }: SiteConfig): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}${routes.sitemap()}\n`
}

export interface FeedItem {
  readonly post: Post
  // An article's body as HTML.
  readonly articleHtml?: string
}

// rss.xml: RSS 2.0, with each post's whole content (caption, photos, video, or article) as HTML
// in its description, so it can be read in a feed reader. `items` are newest first.
export function createRssFeed(items: readonly FeedItem[], site: SiteConfig): string {
  let { siteTitle, siteUrl, siteDescription } = site
  let entries = items.map(({ post, articleHtml }) => {
    let url = siteUrl + routes.post(post.id)
    return [
      '    <item>',
      `      <title>${escapeXml(getPostMeta(post).title ?? siteTitle)}</title>`,
      `      <link>${escapeXml(url)}</link>`,
      `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
      `      <pubDate>${new Date(post.date).toUTCString()}</pubDate>`,
      `      <description>${escapeXml(renderPostHtml(post, siteUrl, articleHtml))}</description>`,
      '    </item>',
    ].join('\n')
  })
  let lastBuildDate = items[0] ? new Date(items[0].post.date).toUTCString() : undefined
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${escapeXml(siteTitle)}</title>`,
    `    <link>${escapeXml(siteUrl + routes.home())}</link>`,
    `    <description>${escapeXml(siteDescription)}</description>`,
    '    <language>en</language>',
    `    <atom:link href="${escapeXml(siteUrl + routes.rss())}" rel="self" type="application/rss+xml"/>`,
    ...(lastBuildDate ? [`    <lastBuildDate>${lastBuildDate}</lastBuildDate>`] : []),
    ...entries,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n')
}

// A post as HTML for a feed reader, with absolute URLs since readers show it away from the site.
// Photos link to the uploaded files rather than resized copies, as readers pick their own sizes.
function renderPostHtml(post: Post, siteUrl: string, articleHtml = ''): string {
  let parts = post.captionHtml ? [post.captionHtml] : []
  let image = (photo: Photo) =>
    `<p><img src="${escapeXml(photo.src)}" alt="${escapeXml(photo.alt)}"${size(photo)}></p>`
  switch (post.type) {
    case 'photos':
      parts.push(...post.photos.map(image))
      break
    case 'video': {
      let { src, posterImage, ...video } = post.video
      let poster = posterImage ? ` poster="${escapeXml(posterImage)}"` : ''
      parts.push(`<p><video src="${escapeXml(src)}"${poster}${size(video)} controls></video></p>`)
      break
    }
    case 'article': {
      let { summary, cover } = post.article
      parts.push(`<p><em>${escapeXml(summary)}</em></p>`)
      if (cover) parts.push(image(cover))
      parts.push(articleHtml)
      break
    }
  }
  return absoluteUrls(parts.join('\n'), siteUrl)
}

function size({
  width,
  height,
}: {
  width?: number | undefined
  height?: number | undefined
}): string {
  return width && height ? ` width="${width}" height="${height}"` : ''
}

// Makes the site-relative URLs in src, href, poster, and srcset attributes absolute.
function absoluteUrls(html: string, siteUrl: string): string {
  return html
    .replace(/ (src|href|poster)="\//g, ` $1="${siteUrl}/`)
    .replace(/ srcset="([^"]*)"/g, (_, srcset: string) => {
      let candidates = srcset
        .split(', ')
        .map((candidate) => (candidate.startsWith('/') ? siteUrl + candidate : candidate))
      return ` srcset="${candidates.join(', ')}"`
    })
}
