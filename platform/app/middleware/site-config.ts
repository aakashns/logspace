import { redirect } from 'remix/response/redirect'
import type { Middleware } from 'remix/router'

import { isSiteConfigured, loadSiteConfig } from '../data/config.ts'
import { routes } from '../routes.ts'

// Loads the site's configuration (the first time, then it's kept in memory and read again in the
// background), so pages, feeds, and anything else a request runs can read it with getSiteConfig.
export function siteConfig(): Middleware {
  return async (_context, next) => {
    await loadSiteConfig()
    return next()
  }
}

// Until the site's required settings are saved (see config.ts), its public pages send visitors to
// the admin login, which leads to /admin/config. The admin pages, and what they need to look right
// (the assets, the site's icons, and the files in public/, which are served before this runs), are
// left alone. The feeds and other files for machines say the site isn't available yet.
export function requireSiteConfig(): Middleware {
  return (context, next) => {
    if (isSiteConfigured()) return next()
    let { pathname } = context.url
    if (ALWAYS_SERVED.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'))) {
      return next()
    }
    if (UNAVAILABLE.includes(pathname)) {
      return new Response('This site isn’t set up yet.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }
    return redirect(routes.admin.login.href(), { headers: { 'Cache-Control': 'no-store' } })
  }
}

// Paths that are served whether or not the site is configured, with everything under them.
const ALWAYS_SERVED = [
  '/admin',
  '/assets',
  '/site',
  routes.favicon.href(),
  routes.appleTouchIcon.href(),
]

const UNAVAILABLE = [
  routes.rss.href(),
  routes.sitemap.href(),
  routes.robots.href(),
  routes.manifest.href(),
]
