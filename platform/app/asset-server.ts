import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { createAssetServer, type AssetServer } from 'remix/assets'

import type { AppAssets } from './assets.ts'

const rootDir = process.cwd()

const SCRIPT_ENTRY = 'app/actions/public/entry.ts'
const GLOBAL_STYLESHEET = 'app/actions/public/global.css'

// Fonts in root public/ that the inlined global stylesheet embeds as data URLs, so they're part of
// the page and render with the first paint (see theme.css).
const EMBEDDED_FONTS = ['/fonts/instrument-sans-latin-600.woff2']

// Compiles the browser's scripts and styles from app/ when they're requested. The binary can't
// (see prebuilt-assets.ts), so it serves the ones binary/build.ts makes with this ahead of time.
export async function createAppAssets({
  development = (process.env.NODE_ENV ?? 'development') === 'development',
} = {}): Promise<AppAssets & { assets: AssetServer }> {
  let assets = createAssetServer({
    basePath: '/assets',
    rootDir,

    allowFiles: ['app/routes.ts', 'app/**/public/**'],
    allowPackages: ['remix'],
    denyFiles: ['app/**/*.test.*'],
    sourceMaps: development ? 'external' : undefined,
    minify: !development,
    watch: development,
    // Outside development, asset URLs carry a content hash and are cached for a year.
    fingerprint: !development,
  })

  let globalStylesheetHref = await assets.getHref(GLOBAL_STYLESHEET)

  return {
    assets,
    scriptEntry: await assets.getScriptEntry(SCRIPT_ENTRY),
    // In development the document links the global stylesheet so edits show up on reload.
    // Elsewhere its CSS, with every @import flattened in, is inlined into the document so first
    // paint doesn't wait on a chain of stylesheet requests.
    globalStylesheet: development
      ? { href: globalStylesheetHref }
      : { css: await embedFonts(await inlineStylesheet(assets, globalStylesheetHref)) },
  }
}

async function inlineStylesheet(assets: AssetServer, href: string): Promise<string> {
  let response = await assets.fetch(new Request(new URL(href, 'http://localhost')))
  if (!response?.ok) throw new Error(`Couldn't load ${href} (${response?.status ?? 404})`)
  let css = await response.text()
  let imports = [...css.matchAll(/@import "([^"]+)";/g)]
  let inlined = await Promise.all(imports.map((match) => inlineStylesheet(assets, match[1])))
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
