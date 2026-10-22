// What a page tells search engines and link previews about itself (see Document).
export interface PageMeta {
  // Path of the page's canonical URL, like "/posts/fc7p7vjhx6".
  path: string
  // Shown before the site title in the <title>; the home page has none.
  title?: string
  description?: string
  // Site-relative or absolute URL of the image shown when the page is shared.
  image?: { url: string; alt?: string; width?: number; height?: number }
  // For posts: when it was published, and the kind of schema.org object it is.
  published?: { date: string; kind: 'BlogPosting' | 'SocialMediaPosting' }
  // Keeps the page out of search results (e.g. "not found" pages).
  noindex?: boolean
}
