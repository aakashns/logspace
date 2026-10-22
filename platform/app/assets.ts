import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { createAssetServer } from 'remix/assets'
import { componentHmr } from 'remix/component-hmr/assets'

const rootDir = process.cwd()
const nodeEnv = process.env.NODE_ENV ?? 'development'
const isDevelopment = nodeEnv === 'development'
const isHmr = Boolean(isDevelopment && process.env.REMIX_NODE_HMR)

export const assets = createAssetServer({
  basePath: '/assets',
  rootDir,

  allowFiles: ['app/routes.ts', 'app/**/public/**'],
  allowPackages: ['remix'],
  denyFiles: ['app/**/*.test.*'],
  sourceMaps: isDevelopment ? 'external' : undefined,
  minify: !isDevelopment,
  watch: isDevelopment,
  // Outside development, asset URLs carry a content hash and are cached for a year.
  fingerprint: !isDevelopment,
  hmr: isHmr
    ? {
        channel: async () => (await import('remix/node-hmr/runtime')).createBrowserHmrChannel(),
        moduleImporter: 'remix/multiple-import-maps-polyfill',
      }
    : undefined,
  scripts: { loaders: isHmr ? [componentHmr()] : undefined },
})

const entry = 'app/actions/public/entry.ts'

export const scriptEntry = await assets.getScriptEntry(entry)

const globalStylesheetHref = await assets.getHref('app/actions/public/global.css')

// Fonts in root public/ that the inlined global stylesheet embeds as data URLs, so they're part of
// the page and render with the first paint (see theme.css).
const EMBEDDED_FONTS = ['/fonts/instrument-sans-latin-600.woff2']

// In development the document links the global stylesheet so edits show up on reload (or via HMR).
// Elsewhere its CSS, with every @import flattened in, is inlined into the document so first paint
// doesn't wait on a chain of stylesheet requests.
export const globalStylesheet: { href?: string; css?: string } = isDevelopment
  ? { href: globalStylesheetHref }
  : { css: await embedFonts(await inlineStylesheet(globalStylesheetHref)) }

async function inlineStylesheet(href: string): Promise<string> {
  let response = await assets.fetch(new Request(new URL(href, 'http://localhost')))
  if (!response?.ok) throw new Error(`Couldn't load ${href} (${response?.status ?? 404})`)
  let css = await response.text()
  let imports = [...css.matchAll(/@import "([^"]+)";/g)]
  let inlined = await Promise.all(imports.map((match) => inlineStylesheet(match[1])))
  return imports.reduce((result, match, i) => result.replace(match[0], () => inlined[i]), css)
}

async function embedFonts(css: string): Promise<string> {
  for (let href of EMBEDDED_FONTS) {
    let font = await fs.readFile(path.join(rootDir, 'public', href))
    let dataUrl = `url("data:font/woff2;base64,${font.toString('base64')}")`
    let embedded = css.replace(/url\("?([^")]+)"?\)/g, (match, url) =>
      url === href ? dataUrl : match,
    )
    if (embedded === css) throw new Error(`The global stylesheet doesn't reference ${href}`)
    css = embedded
  }
  return css
}
