import type { AssetServer, ScriptEntry } from 'remix/assets'

// The browser's scripts and styles: the asset route serves them, render() resolves client entries
// with getScriptEntry, and the document loads the entry script and the global stylesheet.
export interface AppAssets {
  assets: Pick<AssetServer, 'fetch' | 'getScriptEntry'>
  scriptEntry: ScriptEntry
  globalStylesheet: { href?: string; css?: string }
}

// binary/build.ts sets LOGSPACE_ASSETS to "prebuilt" in the code it compiles, which leaves the asset
// server (and the compilers it loads) out of the binary.
export const { assets, scriptEntry, globalStylesheet }: AppAssets =
  process.env.LOGSPACE_ASSETS === 'prebuilt'
    ? await (await import('./prebuilt-assets.ts')).loadPrebuiltAssets()
    : await (await import('./asset-server.ts')).createAppAssets()
