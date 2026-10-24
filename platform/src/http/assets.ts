// The files pages use: Datastar (its bundle with Rocket, for components), the composer's module,
// the heading fonts, and the stylesheets. They're imported as files or built into the binary, and
// read once when the server starts. The scripts' URLs have a hash of them, and fonts never change
// in place, so browsers keep them for a year. In development the stylesheets are made again for
// every page, so an edit shows on reload.
import { Context, Effect, Layer } from 'effect'

import datastarFile from '../../public/datastar-rocket.js' with { type: 'file' }
import latinFont from '../../public/fonts/instrument-sans-latin-600.woff2' with { type: 'file' }
import latinExtFont from '../../public/fonts/instrument-sans-latin-ext-600.woff2' with { type: 'file' }
import { AppConfig } from '../config.ts'
import { hash } from '../services/images.ts'
import { loadClientScripts } from '../views/scripts.ts'
import { loadStylesheets, type Stylesheets } from '../views/stylesheet.ts'

export interface Asset {
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly type: string
}

export class Assets extends Context.Service<
  Assets,
  {
    readonly stylesheets: Effect.Effect<Stylesheets>
    readonly datastarHref: string
    readonly composerHref: string
    // By URL path: the scripts at their hrefs, and the fonts at /fonts/<file>.
    readonly files: ReadonlyMap<string, Asset>
  }
>()('logspace/Assets') {
  static readonly layer = Layer.effect(
    Assets,
    Effect.gen(function* () {
      let { mode } = yield* AppConfig
      let read = (path: string, type: string) =>
        Effect.promise(async () => ({ bytes: await Bun.file(path).bytes(), type }))
      let script = 'text/javascript; charset=utf-8'
      let datastar = yield* read(datastarFile, script)
      let datastarHref = `/assets/datastar.${hash(datastar.bytes)}.js`
      let scripts = yield* Effect.promise(loadClientScripts)
      let composer = { bytes: new TextEncoder().encode(scripts.composer), type: script }
      let composerHref = `/assets/composer.${hash(composer.bytes)}.js`
      let build = Effect.promise(loadStylesheets)
      return Assets.of({
        stylesheets: mode === 'development' ? build : Effect.succeed(yield* build),
        datastarHref,
        composerHref,
        files: new Map([
          [datastarHref, datastar],
          [composerHref, composer],
          ['/fonts/instrument-sans-latin-600.woff2', yield* read(latinFont, 'font/woff2')],
          ['/fonts/instrument-sans-latin-ext-600.woff2', yield* read(latinExtFont, 'font/woff2')],
        ]),
      })
    }),
  )
}
