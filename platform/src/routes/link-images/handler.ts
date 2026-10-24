// The images of link previews, saved from the linked sites.
import { Effect } from 'effect'
import { HttpRouter } from 'effect/http'

import { LinkPreviews } from '../../data/link-previews/link-previews.ts'
import { param } from '../../lib/http/pages.ts'
import { fileResponse, IMMUTABLE, notFound } from '../../lib/http/responses.ts'

// A link preview's image, whose URL has a hash of it.
const linkImage = Effect.gen(function* () {
  let file = yield* (yield* LinkPreviews).image(yield* param('file'))
  return file ? yield* fileResponse(file, IMMUTABLE) : notFound()
})

export const LinkImageRoutes = HttpRouter.addAll([
  HttpRouter.route('GET', '/link-images/:file', linkImage),
])
