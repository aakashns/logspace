// Reading a submitted form, within the limits on uploads (see domain/constants.ts). Bun parses it
// natively; the limits are checked against Content-Length before a byte of the body is read, and
// against the parsed files for a body sent without one. The login form, which anyone can send,
// gets a much smaller limit (see LOGIN_FORM_LIMIT).
import { Effect, Schema } from 'effect'
import { HttpServerRequest } from 'effect/http'

import {
  MAX_UPLOAD_FILE_SIZE,
  MAX_UPLOAD_FILES,
  MAX_UPLOAD_TOTAL_SIZE,
} from '../domain/constants.ts'

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
  if (header === undefined && web.body) {
    let body = yield* Effect.promise(() => readAtMost(web.body!, limit))
    if (!body) return yield* new UploadTooLarge()
    web = new Request(web.url, { method: web.method, headers: web.headers, body })
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

// A body's bytes, or undefined (having stopped reading) once there are more than `limit`.
async function readAtMost(body: ReadableStream<Uint8Array>, limit: number) {
  let chunks: Uint8Array[] = []
  let size = 0
  for await (let chunk of body) {
    size += chunk.byteLength
    if (size > limit) {
      await body.cancel().catch(() => {})
      return undefined
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

// The most a login form can be: a password, with room to spare.
export const LOGIN_FORM_LIMIT = 16 * 1024

// "120 MB".
export const megabytes = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`

export const UPLOAD_TOO_LARGE_MESSAGE =
  `Nothing was saved. Files can be up to ${megabytes(MAX_UPLOAD_FILE_SIZE)} each, and ` +
  `${megabytes(MAX_UPLOAD_TOTAL_SIZE)} in one save. Go back and choose smaller files, or upload ` +
  'them over more than one save.'
