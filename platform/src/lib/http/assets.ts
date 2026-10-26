// The files every page uses: Datastar, the heading fonts, and the document's styles. They're
// imported as files, so the binary embeds them, and read once when the server starts. Datastar's
// URL has a hash of it, and fonts never change in place, so browsers keep both for a year.
import { Context, Effect, Layer } from 'effect'

import datastarFile from '../../../public/datastar.js' with { type: 'file' }
import latinFont from '../../../public/fonts/instrument-sans-latin-600.woff2' with { type: 'file' }
import latinExtFont from '../../../public/fonts/instrument-sans-latin-ext-600.woff2' with { type: 'file' }
import { DOCUMENT_STYLES } from '../../components/document.tsx'
import { hash } from '../images.ts'

// The heading font, embedded in every page as a data URL, so headings render in it from the first
// paint (see ../../components/theme.css).
const EMBEDDED_FONT = '/fonts/instrument-sans-latin-600.woff2'

export interface Asset {
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly type: string
}

export class Assets extends Context.Service<
  Assets,
  {
    // The document's styles, which every page inlines, with the heading font embedded.
    readonly stylesheet: string
    readonly datastarHref: string
    // By URL path: Datastar at datastarHref, and the fonts at /fonts/<file>.
    readonly files: ReadonlyMap<string, Asset>
  }
>()('logspace/Assets') {
  static readonly layer = Layer.effect(
    Assets,
    Effect.gen(function* () {
      let read = (path: string, type: string) =>
        Effect.promise(async () => ({ bytes: await Bun.file(path).bytes(), type }))
      let datastar = yield* read(datastarFile, 'text/javascript; charset=utf-8')
      let datastarHref = `/assets/datastar.${hash(datastar.bytes)}.js`
      let latin = yield* read(latinFont, 'font/woff2')
      let fontUrl = `url("data:font/woff2;base64,${latin.bytes.toBase64()}")`
      return Assets.of({
        stylesheet: DOCUMENT_STYLES.replaceAll(`url(${EMBEDDED_FONT})`, fontUrl),
        datastarHref,
        files: new Map([
          [datastarHref, datastar],
          [EMBEDDED_FONT, latin],
          ['/fonts/instrument-sans-latin-ext-600.woff2', yield* read(latinExtFont, 'font/woff2')],
        ]),
      })
    }),
  )
}
