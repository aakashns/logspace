// The files every page uses: Datastar, the heading fonts, and the stylesheets. They're imported
// as files, so the binary embeds them, and read once when the server starts. Datastar's URL has a
// hash of it, and fonts never change in place, so browsers keep both for a year. In development
// the stylesheets are made again for every page, so an edit shows on reload.
import { Context, Effect, Layer } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/http'

import datastarFile from '../../public/datastar.js' with { type: 'file' }
import latinFont from '../../public/fonts/instrument-sans-latin-600.woff2' with { type: 'file' }
import latinExtFont from '../../public/fonts/instrument-sans-latin-ext-600.woff2' with { type: 'file' }
import { loadStylesheets, type Stylesheets } from '../components/stylesheet.ts'
import { AppConfig } from '../config.ts'
import { hash } from '../lib/images.ts'
import { requestUrl } from './pages.ts'
import { IMMUTABLE, notFound } from './responses.ts'

export interface Asset {
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly type: string
}

export class Assets extends Context.Service<
  Assets,
  {
    readonly stylesheets: Effect.Effect<Stylesheets>
    readonly datastarHref: string
    // By URL path: Datastar at datastarHref, and the fonts at /fonts/<file>.
    readonly files: ReadonlyMap<string, Asset>
  }
>()('logspace/Assets') {
  static readonly layer = Layer.effect(
    Assets,
    Effect.gen(function* () {
      let { mode } = yield* AppConfig
      let read = (path: string, type: string) =>
        Effect.promise(async () => ({ bytes: await Bun.file(path).bytes(), type }))
      let datastar = yield* read(datastarFile, 'text/javascript; charset=utf-8')
      let datastarHref = `/assets/datastar.${hash(datastar.bytes)}.js`
      let build = Effect.promise(loadStylesheets)
      return Assets.of({
        stylesheets: mode === 'development' ? build : Effect.succeed(yield* build),
        datastarHref,
        files: new Map([
          [datastarHref, datastar],
          ['/fonts/instrument-sans-latin-600.woff2', yield* read(latinFont, 'font/woff2')],
          ['/fonts/instrument-sans-latin-ext-600.woff2', yield* read(latinExtFont, 'font/woff2')],
        ]),
      })
    }),
  )
}

// Datastar and the fonts, which never change at a URL.
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
