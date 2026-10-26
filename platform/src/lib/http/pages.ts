// Rendering a page: what it needs to know about the request (see PageContext), and its response,
// with a Content-Security-Policy that lets only this response's scripts run.
import { Effect, Option } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'

import type { Html } from '#jsx/jsx-runtime'
import { THEME_COOKIE_NAME } from '../../components/controls.tsx'
import type { PageContext } from '../../components/document.tsx'
import { SiteConfigQueries } from '../../data/site/queries.ts'
import { Assets } from './assets.ts'
import { ADMIN_HINT_COOKIE } from './admin-session.ts'

// The request's URL, as the browser sent it (with TRUST_PROXY, its protocol and host are the
// ones the proxy forwarded, see middleware.ts).
export const requestUrl = Effect.map(HttpServerRequest.HttpServerRequest, (request) =>
  Option.getOrElse(HttpServerRequest.toURL(request), () => new URL('http://localhost/')),
)

// A path parameter of the route, like the `id` in /posts/:id.
export const param = (name: string) => Effect.map(HttpRouter.params, (params) => params[name] ?? '')

// What every page needs to know about the request. The nonce is new for every response:
// Datastar runs its expressions with it (see ../components/controls.tsx), and nothing else can run.
export const pageContext = Effect.gen(function* () {
  let request = yield* HttpServerRequest.HttpServerRequest
  let assets = yield* Assets
  let theme = request.cookies[THEME_COOKIE_NAME]
  return {
    site: yield* (yield* SiteConfigQueries).saved,
    theme: theme === 'light' || theme === 'dark' ? theme : undefined,
    admin: request.cookies[ADMIN_HINT_COOKIE] === '1',
    nonce: crypto.getRandomValues(new Uint8Array(16)).toHex(),
    stylesheet: assets.stylesheet,
    datastarHref: assets.datastarHref,
    pushScriptHref: assets.pushScriptHref,
  } satisfies PageContext
})

// Where Cloudflare's Turnstile widget comes from: its script, and the frame it shows.
const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com'

// A page's response. Trusted Types are required too: Datastar makes its own policy, and no other
// script can write HTML into the page. A page that shows the Turnstile widget lets its script run
// and its frame load. One with the bell for push notifications lets its script register the
// site's service worker, with a policy of its own that makes only that URL.
export function pageResponse(
  page: PageContext,
  html: Html,
  options?: {
    status?: number | undefined
    turnstile?: boolean | undefined
    pushNotifications?: boolean | undefined
  },
) {
  let turnstile = options?.turnstile ? ` ${TURNSTILE_ORIGIN}` : ''
  let push = options?.pushNotifications === true
  let csp =
    "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'; " +
    `script-src 'nonce-${page.nonce}'${turnstile}; ` +
    (push
      ? "worker-src 'self'; trusted-types datastar push-notifications; "
      : 'trusted-types datastar; ') +
    "require-trusted-types-for 'script'" +
    (turnstile ? `; frame-src${turnstile}` : '')
  return HttpServerResponse.text(html.value, { contentType: 'text/html; charset=utf-8' }).pipe(
    HttpServerResponse.setStatus(options?.status ?? 200),
    HttpServerResponse.setHeader('Content-Security-Policy', csp),
  )
}
