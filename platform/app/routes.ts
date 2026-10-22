import { form, get, post, route } from 'remix/routes'

export const routes = route({
  assets: get('/assets/*path'),
  home: '/',
  sitemap: get('/sitemap.xml'),
  rss: get('/rss.xml'),
  robots: get('/robots.txt'),
  manifest: get('/site.webmanifest'),
  // The site's icon, logo, and social preview image (see app/data/site-images.ts). Browsers and
  // crawlers look for the first two at the root, whatever the page links.
  favicon: get('/favicon.ico'),
  appleTouchIcon: get('/apple-touch-icon.png'),
  siteFile: get('/site/*file'),
  posts: {
    show: get('/posts/:id'),
    // One of the post's files, from media storage (see app/data/media.ts).
    file: get('/posts/:id/*file'),
  },
  // Password-protected pages for managing the site (see app/actions/admin/auth.ts).
  admin: {
    index: get('/admin'),
    login: get('/admin/login'),
    authenticate: post('/admin/login'),
    logout: post('/admin/logout'),
    // The site's title, description, and other settings (see app/data/config.ts).
    config: form('/admin/config'),
    posts: {
      new: form('/admin/posts/new'),
      edit: form('/admin/posts/:id/edit'),
      delete: post('/admin/posts/:id/delete'),
    },
  },
})
