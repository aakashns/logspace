// Builds the logspace binary for the platform it runs on, a single file with Bun's runtime, the
// server, and everything it reads: `bun run build` writes dist/logspace. LOGSPACE_VERSION, if set,
// is the version it reports (`logspace --version`).
//
// Bundling gives every module the binary's own URL as import.meta.url, so the app's modules have
// theirs rewritten to where they'd be in its embedded file system, and the files they find from it
// (migrations, public/, prebuilt assets) are embedded at the same paths: copied into dist/embed/
// in the layout they have here, whose folders are embedded (an embedded folder goes at the root of
// the binary's file system, under its own name, whatever its path). Browser assets are built
// ahead of time (see app/prebuilt-assets.ts), and sharp's native addon is embedded and loaded by
// binary/sharp.ts.
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BunPlugin } from 'bun'

const ROOT_DIR = fileURLToPath(new URL('../', import.meta.url))
const OUTFILE = 'dist/logspace'
const EMBED_DIR = path.join(ROOT_DIR, 'dist/embed')
const VERSION = process.env.LOGSPACE_VERSION || 'dev'

process.chdir(ROOT_DIR)

console.log('Building browser assets...')
process.env.NODE_ENV = 'production'
const { createAppAssets } = await import('../app/asset-server.ts')
const { writePrebuiltAssets, PREBUILT_ASSETS_DIR } = await import('../app/prebuilt-assets.ts')
const appAssets = await createAppAssets({ development: false })
await writePrebuiltAssets(appAssets)
await appAssets.assets.close()

console.log('Collecting the files to embed...')
await fsp.rm(EMBED_DIR, { recursive: true, force: true })
for (let file of [
  'db/migrations',
  'public',
  path.relative(ROOT_DIR, PREBUILT_ASSETS_DIR),
  ...(await sharpFiles()),
]) {
  await fsp.cp(file, path.join(EMBED_DIR, file), { recursive: true })
}

console.log(`Compiling ${OUTFILE} (${VERSION})...`)
const result = await Bun.build({
  entrypoints: ['binary/main.ts'],
  compile: {
    outfile: OUTFILE,
    assets: (await fsp.readdir(EMBED_DIR)).map((name) => path.join(EMBED_DIR, name)),
    // It's configured with environment variables only, wherever it's run from.
    autoloadDotenv: false,
    autoloadBunfig: false,
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env.LOGSPACE_ASSETS': JSON.stringify('prebuilt'),
    'process.env.LOGSPACE_VERSION': JSON.stringify(VERSION),
  },
  // Drops the code for the other asset mode (see app/assets.ts).
  // Remix names a client entry's export after its component function, so names are kept.
  minify: { syntax: true, keepNames: true },
  plugins: [binaryPlugin()],
})
if (!result.success) {
  for (let log of result.logs) console.error(log)
  process.exit(1)
}
console.log(`Built ${OUTFILE}`)

function binaryPlugin(): BunPlugin {
  return {
    name: 'logspace-binary',
    setup(build) {
      // Swap sharp's loader for one that loads the embedded addon.
      build.onResolve({ filter: /^\.\/sharp\.mjs$/ }, (args) =>
        args.importer.includes(`${path.sep}node_modules${path.sep}sharp${path.sep}`)
          ? { path: path.join(ROOT_DIR, 'binary/sharp.ts') }
          : undefined,
      )
      // The binary's own URL is at its embedded file system's root, the build's ROOT_DIR.
      build.onLoad({ filter: /\.tsx?$/ }, async (args) => {
        let file = path.relative(ROOT_DIR, args.path)
        if (file.startsWith('..') || file.split(path.sep).includes('node_modules')) return undefined
        let source = await fsp.readFile(args.path, 'utf8')
        let url = `new URL(${JSON.stringify(file.split(path.sep).join('/'))}, import.meta.url).href`
        return {
          contents: source.replaceAll('import.meta.url', url),
          loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts',
        }
      })
    },
  }
}

// sharp's addon and libvips for this platform, which binary/sharp.ts loads.
async function sharpFiles(): Promise<string[]> {
  let platform = `${process.platform}-${process.arch}`
  let addonDir = `node_modules/@img/sharp-${platform}/lib`
  let libvipsDir = `node_modules/@img/sharp-libvips-${platform}/lib`
  let addons = (await fsp.readdir(addonDir)).filter((name) => name.endsWith('.node'))
  let libraries = (await fsp.readdir(libvipsDir)).filter((name) => name.startsWith('libvips'))
  if (addons.length !== 1 || libraries.length === 0) {
    throw new Error(`sharp isn't installed for ${platform}`)
  }
  return [
    ...addons.map((name) => `${addonDir}/${name}`),
    ...libraries.map((name) => `${libvipsDir}/${name}`),
  ]
}
