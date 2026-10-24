// Every URL the app serves, as functions that build them. The router (http/router.ts) matches
// these paths; pages and feeds link with these functions, so a path is written down once. Ids and
// file names are percent-encoded.

export const routes = {
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
    // The composer, and what it posts to as you write: to add or remove media, and for the
    // preview.
    newPost: () => '/admin/posts/new',
    newPostMedia: () => '/admin/posts/new/media',
    newPostPreview: () => '/admin/posts/new/preview',
    // One of a post's files, published or not, for the composer.
    postFile: (id: string, file: string) =>
      `/admin/posts/${encodeURIComponent(id)}/files/${encodeURIComponent(file)}`,
    editPost: (id: string) => `/admin/posts/${encodeURIComponent(id)}/edit`,
    deletePost: (id: string) => `/admin/posts/${encodeURIComponent(id)}/delete`,
  },
}
