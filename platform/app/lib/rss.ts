import { getPostMeta, type Post } from '../data/posts/presentation.ts'
import { routes } from '../routes.ts'
import { renderCaption } from './caption.ts'
import { getSiteConfig } from '../data/config.ts'
import { escapeXml } from './xml.ts'

export interface FeedItem {
  post: Post
  // An article's body, from getArticleHtml.
  articleHtml?: string
}

// rss.xml: RSS 2.0, with each post's whole content (caption, photos, video, or article) as HTML
// in its description, so it can be read in a feed reader. `items` are newest first.
export function createRssFeed(items: FeedItem[]) {
  let { siteTitle, siteUrl, siteDescription } = getSiteConfig()
  let self = siteUrl + routes.rss.href()
  let entries = items.map(({ post, articleHtml }) => {
    let url = siteUrl + routes.posts.show.href({ id: post.id })
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
    `    <link>${escapeXml(siteUrl + routes.home.href())}</link>`,
    `    <description>${escapeXml(siteDescription)}</description>`,
    '    <language>en</language>',
    `    <atom:link href="${escapeXml(self)}" rel="self" type="application/rss+xml"/>`,
    ...(lastBuildDate ? [`    <lastBuildDate>${lastBuildDate}</lastBuildDate>`] : []),
    ...entries,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n')
}

// A post as HTML for a feed reader, with absolute URLs since readers show it away from the site.
// Photos link to the uploaded files rather than resized copies, as readers pick their own sizes.
function renderPostHtml(post: Post, siteUrl: string, articleHtml = '') {
  let parts = post.caption ? [renderCaption(post.caption)] : []
  let image = (photo: { src: string; alt: string; width?: number; height?: number }) =>
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

function size({ width, height }: { width?: number; height?: number }) {
  return width && height ? ` width="${width}" height="${height}"` : ''
}

// Makes the site-relative URLs in src, href, poster, and srcset attributes absolute.
function absoluteUrls(html: string, siteUrl: string) {
  return html
    .replace(/ (src|href|poster)="\//g, ` $1="${siteUrl}/`)
    .replace(/ srcset="([^"]*)"/g, (_, srcset: string) => {
      let candidates = srcset
        .split(', ')
        .map((candidate) => (candidate.startsWith('/') ? siteUrl + candidate : candidate))
      return ` srcset="${candidates.join(', ')}"`
    })
}
