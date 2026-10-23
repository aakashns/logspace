// Builds the logspace binary for the platform it runs on: one file with Bun's runtime, the app,
// and everything it reads. `bun run build` writes dist/logspace, which reports package.json's
// version (`logspace version`).
//
// The app's files (migrations, Datastar, fonts) are imported as text or files, so Bun embeds them
// without help. Two things are made here: the stylesheets, built ahead of time and defined into
// the code (see src/views/stylesheet.ts), and sharp's native addon and libvips, embedded and
// loaded by scripts/binary-sharp.ts in place of sharp's own loader.
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { BunPlugin } from 'bun'

import packageJson from '../package.json' with { type: 'json' }
import { buildStylesheets } from '../src/views/stylesheet.ts'

const ROOT = path.resolve(import.meta.dir, '..')
const OUTFILE = path.join(ROOT, 'dist/logspace')

console.log(`Compiling ${path.relative(ROOT, OUTFILE)} (${packageJson.version})...`)
let started = performance.now()
let result = await Bun.build({
  entrypoints: [path.join(ROOT, 'src/main.ts')],
  compile: {
    outfile: OUTFILE,
    // It's configured with environment variables only, wherever it's run from.
    autoloadDotenv: false,
    autoloadBunfig: false,
  },
  define: { LOGSPACE_STYLESHEETS: JSON.stringify(await buildStylesheets()) },
  minify: { syntax: true, whitespace: true },
  plugins: [sharpPlugin()],
})
if (!result.success) {
  for (let log of result.logs) console.error(log)
  process.exit(1)
}
let { size } = await fs.stat(OUTFILE)
console.log(
  `Built in ${Math.round(performance.now() - started)} ms: ${(size / 1024 / 1024).toFixed(1)} MB`,
)

function sharpPlugin(): BunPlugin {
  return {
    name: 'logspace-sharp',
    setup(build) {
      // sharp's modules import its loader as ./sharp.mjs.
      build.onResolve({ filter: /^\.\/sharp\.mjs$/ }, (args) =>
        args.importer.includes(`${path.sep}node_modules${path.sep}sharp${path.sep}`)
          ? { path: path.join(ROOT, 'scripts/binary-sharp.ts') }
          : undefined,
      )
      build.onResolve({ filter: /^logspace:sharp-files$/ }, () => ({
        path: 'sharp-files',
        namespace: 'logspace',
      }))
      build.onLoad({ filter: /.*/, namespace: 'logspace' }, async () => {
        let files = await sharpFiles()
        let imports = files.map(
          (file, i) => `import f${i} from ${JSON.stringify(file.source)} with { type: 'file' }`,
        )
        let list = files.map(
          (file, i) => `{ embedded: f${i}, layout: ${JSON.stringify(file.layout)} }`,
        )
        return {
          contents: `${imports.join('\n')}\nexport default [${list.join(', ')}]`,
          loader: 'ts',
        }
      })
    },
  }
}

// sharp's addon and libvips for this platform, and where each goes, as in node_modules/@img.
async function sharpFiles() {
  let platform = `${process.platform}-${process.arch}`
  let packages = [`sharp-${platform}`, `sharp-libvips-${platform}`]
  let files = []
  for (let pkg of packages) {
    let dir = path.join(ROOT, 'node_modules/@img', pkg, 'lib')
    for (let name of await fs.readdir(dir)) {
      if (name.endsWith('.node') || name.startsWith('libvips')) {
        files.push({ source: path.join(dir, name), layout: path.join(pkg, 'lib', name) })
      }
    }
  }
  if (files.length < 2) throw new Error(`sharp isn't installed for ${platform}`)
  return files
}
