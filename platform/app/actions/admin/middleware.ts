import {
  MaxFileSizeExceededError,
  MaxFilesExceededError,
  MaxPartsExceededError,
  MaxTotalSizeExceededError,
} from 'remix/form-data-parser'
import { formData } from 'remix/middleware/form-data'
import { session } from 'remix/middleware/session'
import { redirect } from 'remix/response/redirect'
import { createMiddleware, type Middleware } from 'remix/router'
import { Session } from 'remix/session'

import {
  MAX_UPLOAD_FILE_SIZE,
  MAX_UPLOAD_FILES,
  MAX_UPLOAD_TOTAL_SIZE,
} from '../../lib/constants.ts'
import type { AppContext } from '../../router.ts'
import { routes } from '../../routes.ts'
import { adminSessionCookie, adminSessionStorage, isAdminLoggedIn } from './auth.ts'
import { renderAdminMessage } from './ui/page.tsx'

// Shared by every controller under /admin.
export const adminMiddleware = createMiddleware(
  privatePages(),
  session(adminSessionCookie, adminSessionStorage),
  rejectTooLargeUploads(),
  formData({
    maxFiles: MAX_UPLOAD_FILES,
    maxFileSize: MAX_UPLOAD_FILE_SIZE,
    maxTotalSize: MAX_UPLOAD_TOTAL_SIZE,
  }),
)

// Sends anyone who isn't logged in as admin to the admin login page.
export function requireAdminLogin(): Middleware {
  return (context, next) => {
    let session = context.get(Session)
    if (!session || !isAdminLoggedIn(session)) return redirect(routes.admin.login.href())
    return next()
  }
}

// Keeps these pages out of caches and search results.
function privatePages(): Middleware {
  return async (_context, next) => {
    let response = await next()
    // Copy the headers since some responses (e.g. redirects) have immutable ones.
    let headers = new Headers(response.headers)
    headers.set('Cache-Control', 'no-store')
    headers.set('X-Robots-Tag', 'noindex')
    let { status, statusText } = response
    return new Response(response.body, { status, statusText, headers })
  }
}

// Answers a form that's over formData()'s limits with a page saying so, instead of an error.
function rejectTooLargeUploads(): Middleware {
  return async (context, next) => {
    try {
      return await next()
    } catch (error) {
      if (
        error instanceof MaxFileSizeExceededError ||
        error instanceof MaxFilesExceededError ||
        error instanceof MaxPartsExceededError ||
        error instanceof MaxTotalSizeExceededError
      ) {
        // The router's render middleware has run, though Middleware's type doesn't know it.
        let { render } = context as unknown as AppContext
        let mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`
        let message =
          `Nothing was saved. Files can be up to ${mb(MAX_UPLOAD_FILE_SIZE)} each, and ` +
          `${mb(MAX_UPLOAD_TOTAL_SIZE)} in one save. Go back and choose smaller files, or upload ` +
          'them over more than one save.'
        return render(
          ...renderAdminMessage(context.request, 'Upload too large', message, { status: 413 }),
        )
      }
      throw error
    }
  }
}
