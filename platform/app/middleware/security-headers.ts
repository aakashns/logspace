import type { Middleware } from 'remix/router'

// Hardening headers for every response. Script-src CSP and Trusted Types are left out: Remix
// renders inline import maps and styles and has no nonce support yet, so they'd break the page.
const SECURITY_HEADERS = {
  // Browsers ignore this over plain HTTP, so it's a no-op in development.
  'Strict-Transport-Security': 'max-age=63072000',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
}

export function securityHeaders(): Middleware {
  return async (_context, next) => {
    let response = await next()
    // Copy the headers since some responses (e.g. Response.redirect()) have immutable ones.
    let headers = new Headers(response.headers)
    for (let [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (!headers.has(name)) headers.set(name, value)
    }
    let { status, statusText } = response
    return new Response(response.body, { status, statusText, headers })
  }
}
