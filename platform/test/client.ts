import { router } from '../app/router.ts'
import { routes } from '../app/routes.ts'

// Requests to the app's router, as a browser would make them.

// bun run test sets ADMIN_PASSWORD to this.
export const ADMIN_PASSWORD = 'test-password-1234'

export function fetch(path: string, init?: RequestInit) {
  return router.fetch(new Request(new URL(path, 'http://localhost'), init))
}

export function logInAdmin(password = ADMIN_PASSWORD, headers?: HeadersInit) {
  return fetch(routes.admin.authenticate.href(), {
    method: 'POST',
    headers,
    body: new URLSearchParams({ password }),
  })
}

// The `name=value` part of the session cookie a response sets, to send back on later requests.
export function sessionCookie(response: Response) {
  let header = response.headers.getSetCookie().find((cookie) => cookie.startsWith('admin_session='))
  return header?.split(';')[0]
}

// A request with a new admin session.
export async function adminFetch(path: string, init?: RequestInit) {
  let cookie = sessionCookie(await logInAdmin())!
  return fetch(path, { ...init, headers: { Cookie: cookie, ...init?.headers } })
}
