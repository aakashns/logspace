// What runs around every request, in this order:
//
// 1. Behind the proxy (TRUST_PROXY=1), the request takes the protocol and host the browser used.
// 2. A form posted from another site is refused, so a page elsewhere can't act with an admin's
//    login.
// 3. Until the site's required settings are saved, its public pages send visitors to the admin
//    login (the gate below).
// 4. The route's handler runs. A path no route matches is a 404, and an unexpected error is a 500,
//    logged with its cause.
// 5. Every response gets the security headers, unless it set its own (pages set a CSP with their
//    nonce, see pages.ts).
import { Cause, Effect, Option } from 'effect'
import {
  Headers,
  HttpRouter,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/http'

import { AppConfig } from '../config.ts'
import { routes } from '../routes.ts'
import { SiteConfigQueries } from '../site/queries.ts'
import { isSiteConfigured } from '../site/site.ts'
import { getForwardedOrigin } from './forwarded.ts'
import { notFound, redirect, textResponse } from './responses.ts'

// Hardening headers for every response. Pages replace the Content-Security-Policy with one that
// lets Datastar run (see pages.ts); everything else (files, feeds, errors) runs no scripts at
// all. Browsers ignore HSTS over plain HTTP, so it's a no-op in development.
export const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=63072000',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy':
    "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; script-src 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
}

export const AppMiddleware = HttpRouter.middleware(
  Effect.gen(function* () {
    let { trustProxy } = yield* AppConfig
    let siteConfig = yield* SiteConfigQueries

    return (handler) =>
      Effect.gen(function* () {
        let request = yield* HttpServerRequest.HttpServerRequest
        if (trustProxy) request = withForwardedOrigin(request)
        let refusal = checkCrossOrigin(request)
        let response = refusal
          ? refusal
          : yield* gate(request, siteConfig.saved).pipe(
              Effect.flatMap((blocked) => (blocked ? Effect.succeed(blocked) : handler)),
              Effect.catchCause(handleFailure),
              Effect.provideService(HttpServerRequest.HttpServerRequest, request),
            )
        return HttpServerResponse.setHeaders(
          response,
          Object.fromEntries(
            Object.entries(SECURITY_HEADERS).filter(
              ([name]) => response.headers[name.toLowerCase()] === undefined,
            ),
          ),
        )
      })
  }),
  { global: true },
)

function withForwardedOrigin(request: HttpServerRequest.HttpServerRequest) {
  let { protocol, host } = getForwardedOrigin(request.headers)
  return request.modify({
    ...(protocol && { protocol }),
    ...(host && { headers: Headers.set(request.headers, 'host', host) }),
  })
}

// Refuses a form posted from another site, as Remix's cop() middleware did in LogSpace 0.1: browsers say
// where a request came from in Sec-Fetch-Site, and older ones in Origin, which must then be this
// site. A request with neither isn't from a browser, so there's no login to misuse.
function checkCrossOrigin(request: HttpServerRequest.HttpServerRequest) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return undefined
  let site = request.headers['sec-fetch-site']?.trim().toLowerCase()
  if (site === 'same-origin' || site === 'none') return undefined
  if (site) {
    return textResponse('Forbidden: cross-origin request detected from Sec-Fetch-Site header', 403)
  }
  let origin = request.headers['origin']?.trim()
  let host = Option.map(HttpServerRequest.toURL(request), (url) => url.host)
  if (!origin || URL.parse(origin)?.host === Option.getOrUndefined(host)) return undefined
  return textResponse(
    'Forbidden: cross-origin request detected, and/or browser is out of date: Sec-Fetch-Site is missing, and Origin does not match Host',
    403,
  )
}

// Paths served whether or not the site is configured, with everything under them: the admin
// pages, and what they need to look right.
const ALWAYS_SERVED = [
  '/admin',
  '/assets',
  '/fonts',
  '/site',
  routes.favicon(),
  routes.appleTouchIcon(),
]

// Files for machines, which say the site isn't available yet.
const UNAVAILABLE = [routes.rss(), routes.sitemap(), routes.robots(), routes.manifest()]

// Until the site's required settings are saved, its public pages send visitors to the admin
// login, which leads to /admin/config.
const gate = Effect.fnUntraced(function* (
  request: HttpServerRequest.HttpServerRequest,
  savedConfig: SiteConfigQueries['Service']['saved'],
) {
  if (isSiteConfigured(yield* savedConfig)) return undefined
  let [pathname = ''] = request.url.split('?')
  if (ALWAYS_SERVED.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'))) {
    return undefined
  }
  if (UNAVAILABLE.includes(pathname)) {
    return textResponse('This site isn’t set up yet.', 503, { 'Cache-Control': 'no-store' })
  }
  return HttpServerResponse.setHeader(redirect(routes.admin.login()), 'Cache-Control', 'no-store')
})

const handleFailure = (cause: Cause.Cause<unknown>) => {
  // The browser went away; there's no one to answer.
  if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause)
  let error = Cause.squash(cause)
  if (HttpServerError.isHttpServerError(error) && error.reason._tag === 'RouteNotFound') {
    return Effect.succeed(notFound())
  }
  return Effect.as(
    Effect.logError('Request failed', cause),
    textResponse('Internal Server Error', 500),
  )
}
