import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { AssetServer, ScriptEntry } from 'remix/assets'

import type { AppAssets } from './assets.ts'

// The binary serves the browser's scripts and styles from files binary/build.ts writes here with
// the asset server, ahead of time, and embeds: compiling them takes native compilers and app/'s
// sources, which the binary doesn't have.
const ROOT_DIR = fileURLToPath(new URL('../', import.meta.url))
export const PREBUILT_ASSETS_DIR = path.join(ROOT_DIR, 'dist/assets')
const MANIFEST_FILE = path.join(PREBUILT_ASSETS_DIR, 'manifest.json')
const FILES_DIR = path.join(PREBUILT_ASSETS_DIR, 'files')

interface Manifest {
  // The document's script entry, a key of scriptEntries.
  scriptEntry: string
  // Every script that can be an entry (those in app/**/public/), by path from the app's root.
  scriptEntries: Record<string, ScriptEntry>
  globalStylesheet: string
  // Each asset's response headers, by URL path. Its body is the file at that path in files/.
  files: Record<string, Record<string, string>>
}

export async function loadPrebuiltAssets(): Promise<AppAssets> {
  let manifest: Manifest = JSON.parse(await fsp.readFile(MANIFEST_FILE, 'utf8'))
  return {
    assets: {
      async fetch(request) {
        let { pathname } = new URL(request.url)
        let headers = Object.hasOwn(manifest.files, pathname) ? manifest.files[pathname] : undefined
        if (!headers || (request.method !== 'GET' && request.method !== 'HEAD')) return null
        let body =
          request.method === 'HEAD' ? null : await fsp.readFile(path.join(FILES_DIR, pathname))
        return new Response(body, { headers })
      },
      async getScriptEntry(filePath) {
        let entry = manifest.scriptEntries[toEntryKey(filePath)]
        if (!entry) throw new Error(`${filePath} wasn't built as a script entry`)
        return entry
      },
    },
    scriptEntry: manifest.scriptEntries[manifest.scriptEntry],
    globalStylesheet: { css: manifest.globalStylesheet },
  }
}

// Writes the assets a production asset server serves for every script in app/**/public/, and the
// URLs they load, following imports.
export async function writePrebuiltAssets({
  assets,
  scriptEntry,
  globalStylesheet,
}: AppAssets & { assets: AssetServer }): Promise<void> {
  if (globalStylesheet.css === undefined) throw new Error('Prebuild assets for production')

  let scriptEntries: Manifest['scriptEntries'] = {}
  for (let file of await listScripts(path.join(ROOT_DIR, 'app'))) {
    scriptEntries[toEntryKey(file)] = await assets.getScriptEntry(file)
  }
  let mainEntry = Object.keys(scriptEntries).find(
    (key) => scriptEntries[key].href === scriptEntry.href,
  )
  if (!mainEntry) throw new Error(`The script entry ${scriptEntry.href} isn't in app/**/public/`)

  // Scripts import each other by their URLs without the fingerprint, which the import maps map to
  // the fingerprinted ones that are served.
  let importMap: Record<string, string> = {}
  for (let { importMap: map } of Object.values(scriptEntries)) {
    for (let imports of [map.imports, ...Object.values(map.scopes ?? {})]) {
      Object.assign(importMap, imports)
    }
  }
  let queue = new Set([
    ...Object.values(scriptEntries).flatMap((entry) => [entry.href, ...entry.preloads]),
    ...Object.values(importMap),
  ])
  let files: Manifest['files'] = {}
  await fsp.rm(PREBUILT_ASSETS_DIR, { recursive: true, force: true })
  for (let href of queue) {
    let { pathname } = new URL(href, 'http://localhost')
    if (files[pathname]) continue
    let response = await assets.fetch(new Request(new URL(pathname, 'http://localhost')))
    if (!response?.ok) throw new Error(`Couldn't build ${pathname} (${response?.status ?? 404})`)
    let body = Buffer.from(await response.arrayBuffer())
    let file = path.join(FILES_DIR, pathname)
    await fsp.mkdir(path.dirname(file), { recursive: true })
    await fsp.writeFile(file, body)
    files[pathname] = Object.fromEntries(
      [...response.headers].filter(([name]) => name.toLowerCase() !== 'date'),
    )
    for (let match of body.toString('utf8').matchAll(/["'](\/assets\/[^"'?#\s]+)/g)) {
      queue.add(importMap[match[1]] ?? match[1])
    }
  }

  let manifest: Manifest = {
    scriptEntry: mainEntry,
    scriptEntries,
    globalStylesheet: globalStylesheet.css,
    files,
  }
  await fsp.writeFile(MANIFEST_FILE, JSON.stringify(manifest))
}

async function listScripts(dir: string): Promise<string[]> {
  let names = await fsp.readdir(dir, { recursive: true })
  return names
    .filter((name) => /(^|\/)public\/.*\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => path.join(dir, name))
    .sort()
}

// Entries are looked up by path from the app's root: in the binary a module's file URL is in its
// embedded file system, not where it was built.
function toEntryKey(filePath: string): string {
  let file = filePath.startsWith('file:')
    ? fileURLToPath(filePath)
    : path.resolve(ROOT_DIR, filePath)
  return path.relative(ROOT_DIR, file).split(path.sep).join('/')
}
