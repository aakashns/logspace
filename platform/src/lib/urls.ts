// Every URL the app serves, as functions that build them. The handlers (../routes/) match
// these paths; pages and feeds link with these functions, so a path is written down once. Ids and
// file names are percent-encoded.

export const urls = {
  home: () => '/',
  sitemap: () => '/sitemap.xml',
  rss: () => '/rss.xml',
  robots: () => '/robots.txt',
  manifest: () => '/site.webmanifest',
  // The site's icon, logos, and banner image. Browsers and crawlers look for the first two
  // at the root, whatever the page links.
  favicon: () => '/favicon.ico',
  appleTouchIcon: () => '/apple-touch-icon.png',
  siteFile: (file: string) => `/site/${encodeURIComponent(file)}`,
  // A link preview's image, saved from the linked site and resized to `width` (one of
  // IMAGE_WIDTHS). `version` is a hash of the image, so the URL never serves anything else.
  linkImage: (version: string, width: number) => `/link-images/${version}-${width}.webp`,
  post: (id: string) => `/posts/${encodeURIComponent(id)}`,
  // One of a post's files, from media storage.
  postFile: (id: string, file: string) =>
    `/posts/${encodeURIComponent(id)}/${encodeURIComponent(file)}`,
  admin: {
    index: () => '/admin',
    login: () => '/admin/login',
    logout: () => '/admin/logout',
    config: () => '/admin/config',
    // The composer, for a new post or an edit, and what it posts to: to save the post, and as
    // you write, to add or remove media, and for the preview.
    newPost: () => '/admin/posts/new',
    editPost: (id: string) => `/admin/posts/${encodeURIComponent(id)}/edit`,
    savePost: () => '/admin/posts',
    discardPost: () => '/admin/posts/discard',
    postMedia: () => '/admin/posts/media',
    postPreview: () => '/admin/posts/preview',
    // One of a post's files, published or not, for the composer.
    postFile: (id: string, file: string) =>
      `/admin/posts/${encodeURIComponent(id)}/files/${encodeURIComponent(file)}`,
    deletePost: (id: string) => `/admin/posts/${encodeURIComponent(id)}/delete`,
  },
}
