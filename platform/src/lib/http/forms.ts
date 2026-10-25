// Reading a submitted form, within the limits on uploads (below). Bun parses it
// natively; the limits are checked against Content-Length before a byte of the body is read, and
// against the parsed files for a body sent without one. The login form, which anyone can send,
// gets a much smaller limit (see LOGIN_FORM_LIMIT).
import { Effect, Schema, Stream } from 'effect'
import { HttpServerRequest } from 'effect/http'

// Limits on one submission of an /admin form. Uploaded files are held in memory until they're
// saved, so these also bound how much memory an upload takes. The total stays under Bun's limit
// on a request's body (128 MB), so a form over it gets the 413 page that says why.
export const MAX_UPLOAD_FILE_SIZE = 100 * 1024 * 1024
export const MAX_UPLOAD_TOTAL_SIZE = 120 * 1024 * 1024
// File inputs count even when no file is chosen, and a photos post has one per photo.
export const MAX_UPLOAD_FILES = 100

// The form was over the limits, and nothing in it was saved.
export class UploadTooLarge extends Schema.TaggedError<UploadTooLarge>()('UploadTooLarge', {}) {}

// The body wasn't a form.
export class MalformedForm extends Schema.TaggedError<MalformedForm>()('MalformedForm', {}) {}

// A form of up to `limit` bytes. One that says it's bigger is refused before its body is read;
// one that doesn't say (sent in chunks) is read only until it passes the limit.
export const readForm = Effect.fnUntraced(function* (limit = MAX_UPLOAD_TOTAL_SIZE) {
  let request = yield* HttpServerRequest.HttpServerRequest
  let header = request.headers['content-length']
  if (header !== undefined && !(Number(header) <= limit)) return yield* new UploadTooLarge()
  let web = yield* HttpServerRequest.toWeb(request).pipe(Effect.mapError(() => new MalformedForm()))
  let { body } = web
  if (header === undefined && body) {
    let read = yield* readAtMost(body, limit)
    if (!read) return yield* new UploadTooLarge()
    web = new Request(web.url, { method: web.method, headers: web.headers, body: read })
  }
  let form = yield* Effect.tryPromise({
    try: () => web.formData(),
    catch: () => new MalformedForm(),
  })
  let files: File[] = []
  form.forEach((value) => typeof value !== 'string' && files.push(value))
  let total = files.reduce((sum, file) => sum + file.size, 0)
  if (
    files.length > MAX_UPLOAD_FILES ||
    files.some((file) => file.size > MAX_UPLOAD_FILE_SIZE) ||
    total > MAX_UPLOAD_TOTAL_SIZE
  ) {
    return yield* new UploadTooLarge()
  }
  return form
})

// A body's bytes, or undefined (having stopped reading) once there are more than `limit`. A body
// that breaks off (the browser went away) isn't a form.
const readAtMost = Effect.fnUntraced(function* (body: ReadableStream<Uint8Array>, limit: number) {
  let size = 0
  let chunks = yield* Stream.fromReadableStream({
    evaluate: () => body,
    onError: () => new MalformedForm(),
  }).pipe(
    Stream.takeUntil((chunk) => (size += chunk.byteLength) > limit),
    Stream.runCollect,
  )
  return size > limit ? undefined : Buffer.concat(chunks)
})

// The most a login form can be: a password and Turnstile's token (at most 2 KB), with room to
// spare.
export const LOGIN_FORM_LIMIT = 16 * 1024

// A form's text field, trimmed (a pasted key often has spaces or a line break around it), or ''
// for a missing one or a file.
export function formText(form: FormData, name: string): string {
  let value = form.get(name)
  return typeof value === 'string' ? value.trim() : ''
}

// "120 MB".
export const megabytes = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`

export const UPLOAD_TOO_LARGE_MESSAGE =
  `Nothing was saved. Files can be up to ${megabytes(MAX_UPLOAD_FILE_SIZE)} each, and ` +
  `${megabytes(MAX_UPLOAD_TOTAL_SIZE)} in one save. Go back and choose smaller files, or upload ` +
  'them over more than one save.'
