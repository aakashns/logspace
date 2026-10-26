// The files pages use: Datastar, the heading fonts, the document's styles, and the home page's
// script for push notifications, with its service worker. They're imported as files, so the
// binary embeds them, and read once when the server starts. The scripts' URLs have a hash of them,
// and fonts never change in place, so browsers keep them for a year. The service worker is at one
// URL for good, as browsers know it by its URL, and check it for a new version themselves.
import { Context, Effect, Layer } from 'effect'

import datastarFile from '../../../public/datastar.js' with { type: 'file' }
import pushScriptFile from '../../../public/push-notifications.js' with { type: 'file' }
import pushWorkerFile from '../../../public/push-worker.js' with { type: 'file' }
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
    // Where the home page's script for push notifications is served.
    readonly pushScriptHref: string
    // By URL path: Datastar at datastarHref, the push script at pushScriptHref, and the fonts at
    // /fonts/<file>.
    readonly files: ReadonlyMap<string, Asset>
    // The service worker that shows push notifications (see urls.pushWorker).
    readonly pushWorker: Asset
  }
>()('logspace/Assets') {
  static readonly layer = Layer.effect(
    Assets,
    Effect.gen(function* () {
      let read = (path: string, type: string) =>
        Effect.promise(async () => ({ bytes: await Bun.file(path).bytes(), type }))
      let datastar = yield* read(datastarFile, 'text/javascript; charset=utf-8')
      let datastarHref = `/assets/datastar.${hash(datastar.bytes)}.js`
      let pushScript = yield* read(pushScriptFile, 'text/javascript; charset=utf-8')
      let pushScriptHref = `/assets/push-notifications.${hash(pushScript.bytes)}.js`
      let latin = yield* read(latinFont, 'font/woff2')
      let fontUrl = `url("data:font/woff2;base64,${latin.bytes.toBase64()}")`
      return Assets.of({
        stylesheet: DOCUMENT_STYLES.replaceAll(`url(${EMBEDDED_FONT})`, fontUrl),
        datastarHref,
        pushScriptHref,
        files: new Map([
          [datastarHref, datastar],
          [pushScriptHref, pushScript],
          [EMBEDDED_FONT, latin],
          ['/fonts/instrument-sans-latin-ext-600.woff2', yield* read(latinExtFont, 'font/woff2')],
        ]),
        pushWorker: yield* read(pushWorkerFile, 'text/javascript; charset=utf-8'),
      })
    }),
  )
}
