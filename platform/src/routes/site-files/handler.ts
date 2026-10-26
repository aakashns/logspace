// The site's files: the web app manifest, and its icons, logos, and banner image.
import { Effect } from 'effect'
import { HttpRouter } from 'effect/http'

import { getSiteFile, resizedSiteFile, siteIconColor } from '../../data/site/files.ts'
import { configuredSite, SiteConfigQueries } from '../../data/site/queries.ts'
import { getIconHref } from '../../data/site/site-images.ts'
import { param, requestUrl } from '../../lib/http/pages.ts'
import { fileResponse, IMMUTABLE, notFound, textFileResponse } from '../../lib/http/responses.ts'

// Named after the site, for browsers that install it as an app, in its icon's color.
const manifest = Effect.gen(function* () {
  let site = yield* configuredSite
  let color = yield* siteIconColor(site)
  let icon = (file: string, size: number) => ({
    src: getIconHref(site, file),
    sizes: `${size}x${size}`,
    type: 'image/png',
  })
  let manifest = {
    name: site.siteTitle,
    start_url: '/',
    display: 'browser',
    background_color: color,
    theme_color: color,
    icons: [icon('icon-192.png', 192), icon('icon-512.png', 512)],
  }
  return textFileResponse(JSON.stringify(manifest, null, 2), 'application/manifest+json')
})

// One of the site's image files. A URL with its current version is cached for a year, since a
// new upload gets a new one; anything else for an hour. The banner's resized copies, with `w` as
// well, only have URLs with a version. They're served before the site is configured too, for the
// admin pages.
const siteFile = (name: string) =>
  Effect.gen(function* () {
    let saved = yield* (yield* SiteConfigQueries).saved
    let { searchParams } = yield* requestUrl
    let version = searchParams.get('v')
    let width = searchParams.get('w')
    if (version !== null && width !== null) {
      let variant = yield* resizedSiteFile(name, Number(width), version, saved)
      return variant ? yield* fileResponse(variant, IMMUTABLE) : notFound()
    }
    let found = yield* getSiteFile(name, saved)
    if (!found) return notFound()
    let current = version === found.version
    return yield* fileResponse(found.file, current ? IMMUTABLE : 'public, max-age=3600')
  })

export const SiteFileRoutes = HttpRouter.addAll([
  HttpRouter.route('GET', '/site.webmanifest', manifest),
  HttpRouter.route('GET', '/favicon.ico', siteFile('favicon.ico')),
  HttpRouter.route('GET', '/apple-touch-icon.png', siteFile('apple-touch-icon.png')),
  HttpRouter.route(
    'GET',
    '/site/:file',
    Effect.flatMap(param('file'), (name) =>
      // These two are served at the root.
      name === 'favicon.ico' || name === 'apple-touch-icon.png'
        ? Effect.succeed(notFound())
        : siteFile(name),
    ),
  ),
])
