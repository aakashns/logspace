// Builds the logspace binary for the platform it runs on: one file with Bun's runtime, the app,
// and everything it reads. `bun run build` writes dist/logspace, which reports package.json's
// version (`logspace version`).
//
// The app's files (migrations, CSS, Datastar, fonts, the default icon) are imported as text or
// files, so Bun embeds them without help.
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import packageJson from '../package.json' with { type: 'json' }

const ROOT = path.resolve(import.meta.dir, '..')
const OUTFILE = path.join(ROOT, 'dist/logspace')

console.log(`Compiling ${path.relative(ROOT, OUTFILE)} (${packageJson.version})...`)
let started = performance.now()
let result = await Bun.build({
  entrypoints: [path.join(ROOT, 'src/cli/index.ts')],
  compile: {
    outfile: OUTFILE,
    // It's configured with environment variables only, wherever it's run from.
    autoloadDotenv: false,
    autoloadBunfig: false,
  },
  minify: { syntax: true, whitespace: true },
})
if (!result.success) {
  for (let log of result.logs) console.error(log)
  process.exit(1)
}
let { size } = await fs.stat(OUTFILE)
console.log(
  `Built in ${Math.round(performance.now() - started)} ms: ${(size / 1024 / 1024).toFixed(1)} MB`,
)
