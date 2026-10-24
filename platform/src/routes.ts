// Every URL the app serves, as functions that build them. The router (http/router.ts) matches
// these paths; pages and feeds link with these functions, so a path is written down once. Ids and
// file names are percent-encoded.

export const routes = {
  home: () => '/',
  sitemap: () => '/sitemap.xml',
  rss: () => '/rss.xml',
  robots: () => '/robots.txt',
  manifest: () => '/site.webmanifest',
  // The site's icon, logo, and banner image. Browsers and crawlers look for the first two
  // at the root, whatever the page links.
  favicon: () => '/favicon.ico',
  appleTouchIcon: () => '/apple-touch-icon.png',
  siteFile: (file: string) => `/site/${encodeURIComponent(file)}`,
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
    discardNewPost: () => '/admin/posts/new/discard',
    // The composer again whenever the draft changes, as server-sent events, for one tab.
    newPostUpdates: (tab: string) => `/admin/posts/new/updates?tab=${encodeURIComponent(tab)}`,
    // One of a post's files, published or not, for the composer.
    postFile: (id: string, file: string) =>
      `/admin/posts/${encodeURIComponent(id)}/files/${encodeURIComponent(file)}`,
    editPost: (id: string) => `/admin/posts/${encodeURIComponent(id)}/edit`,
    deletePost: (id: string) => `/admin/posts/${encodeURIComponent(id)}/delete`,
  },
}
