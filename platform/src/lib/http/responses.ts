// Responses the handlers share: files (with ranges and revalidation), redirects, and errors.
import { Effect } from 'effect'
import { HttpServerRequest, HttpServerResponse } from 'effect/http'

import type { StoredFile } from '../media-storage.ts'

// For URLs with a hash of what they serve in them, which change when it does.
export const IMMUTABLE = 'public, max-age=31536000, immutable'

// A plain text response, like an error's.
export const textResponse = (text: string, status: number, headers?: Record<string, string>) =>
  HttpServerResponse.text(text, { status, headers, contentType: 'text/plain; charset=utf-8' })

// A file for machines, like a feed, of this type, in UTF-8.
export const textFileResponse = (body: string, type: string) =>
  HttpServerResponse.text(body, { contentType: `${type}; charset=utf-8` })

export const notFound = () => textResponse('Not Found', 404)

// A redirect after a form is handled is a 303, so the browser follows it with a GET.
export const redirect = (location: string, status: 302 | 303 = 302) =>
  HttpServerResponse.redirect(location, { status })

// Keeps a page that's for one person, like the admin's or a sign-up's, out of caches and search
// results.
export const privately = (response: HttpServerResponse.HttpServerResponse) =>
  HttpServerResponse.setHeaders(response, {
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex',
  })

// A stored file, as GET and HEAD get it: in full, or the byte range a video player asks for, or
// a 304 when the browser's copy is current. With the fs backend the body is the file on disk,
// which Bun sends without reading it into memory.
export const fileResponse = Effect.fnUntraced(function* (file: StoredFile, cacheControl: string) {
  let request = yield* HttpServerRequest.HttpServerRequest
  let etag = `W/"${file.size.toString(16)}-${Math.floor(file.lastModified).toString(16)}"`
  let lastModified = new Date(file.lastModified).toUTCString()
  let headers: Record<string, string> = {
    'Cache-Control': cacheControl,
    ETag: etag,
    'Last-Modified': lastModified,
    'Accept-Ranges': 'bytes',
  }

  if (isFresh(request.headers, etag, file.lastModified)) {
    return HttpServerResponse.empty({ status: 304, headers })
  }

  let range = parseRange(request.headers['range'], file.size, request.headers['if-range'], etag)
  if (range === 'unsatisfiable') {
    return HttpServerResponse.empty({
      status: 416,
      headers: { ...headers, 'Content-Range': `bytes */${file.size}` },
    })
  }
  let [start, end] = range ?? [0, file.size - 1]
  let body = range ? file.blob.slice(start, end + 1) : file.blob
  return HttpServerResponse.raw(request.method === 'HEAD' ? null : body, {
    status: range ? 206 : 200,
    contentType: file.type,
    contentLength: end - start + 1,
    headers: range
      ? { ...headers, 'Content-Range': `bytes ${start}-${end}/${file.size}` }
      : headers,
  })
})

// Whether the browser's copy is the one it would get: its ETag matches, or (without one) it's
// no older than the file.
function isFresh(
  headers: Readonly<Record<string, string | undefined>>,
  etag: string,
  mtime: number,
) {
  let ifNoneMatch = headers['if-none-match']
  if (ifNoneMatch !== undefined) {
    let weak = (tag: string) => tag.trim().replace(/^W\//, '')
    return ifNoneMatch.split(',').some((tag) => tag.trim() === '*' || weak(tag) === weak(etag))
  }
  let since = Date.parse(headers['if-modified-since'] ?? '')
  return !Number.isNaN(since) && Math.floor(mtime / 1000) * 1000 <= since
}

// The one byte range a Range header asks for, as [first, last], undefined for the whole file
// (no Range, more than one range, a malformed one, or an If-Range that no longer matches), or
// 'unsatisfiable' if it starts past the end.
function parseRange(
  header: string | undefined,
  size: number,
  ifRange: string | undefined,
  etag: string,
): [number, number] | 'unsatisfiable' | undefined {
  if (!header || (ifRange !== undefined && ifRange !== etag)) return undefined
  let match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (match[1] === '' && match[2] === '')) return undefined
  let [start, end] =
    match[1] === ''
      ? [Math.max(0, size - Number(match[2])), size - 1]
      : [Number(match[1]), match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)]
  if (start >= size || size === 0) return 'unsatisfiable'
  if (end < start) return undefined
  return [start, end]
}
