// Datastar and the fonts, embedded in the binary (see ../../lib/http/assets.ts). They never change
// at a URL.
import { Effect } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/http'

import { Assets } from '../../lib/http/assets.ts'
import { requestUrl } from '../../lib/http/pages.ts'
import { IMMUTABLE, notFound } from '../../lib/http/responses.ts'

const asset = Effect.gen(function* () {
  let { pathname } = yield* requestUrl
  let file = (yield* Assets).files.get(pathname)
  if (!file) return notFound()
  return HttpServerResponse.uint8Array(file.bytes, {
    contentType: file.type,
    headers: { 'Cache-Control': IMMUTABLE },
  })
})

export const AssetRoutes = HttpRouter.addAll([
  HttpRouter.route('GET', '/assets/:file', asset),
  HttpRouter.route('GET', '/fonts/:file', asset),
])
