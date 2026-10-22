// Loads sharp's native addon in the binary, in place of sharp's own loader (build.ts swaps it in),
// which looks for it in node_modules. The addon and libvips, the library it links to, are
// embedded in the binary, but a library can only be loaded from a real file, and the addon finds
// libvips by a path relative to its own, so both are copied into a private temporary folder in
// the layout node_modules/@img has, loaded, and deleted (a loaded library stays loaded).
import * as fs from 'node:fs'
import { createRequire } from 'node:module'
import * as os from 'node:os'
import * as path from 'node:path'

import { copyEmbeddedDir, EMBEDDED_ROOT } from './embedded.ts'

const platform = `${process.platform}-${process.arch}`
const packages = [`sharp-${platform}`, `sharp-libvips-${platform}`]

let tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logspace-sharp-'))
let sharp
try {
  for (let pkg of packages) {
    copyEmbeddedDir(path.join(EMBEDDED_ROOT, 'node_modules/@img', pkg), path.join(tmpDir, pkg))
  }
  let addonDir = path.join(tmpDir, packages[0], 'lib')
  let addon = fs.readdirSync(addonDir).find((name) => name.endsWith('.node'))
  if (!addon) throw new Error(`sharp's addon for ${platform} isn't in the binary`)
  sharp = createRequire(import.meta.url)(path.join(addonDir, addon))
} catch (error) {
  throw new Error(
    `Couldn't load sharp's native addon from ${tmpDir}. If the temporary folder doesn't allow ` +
      'running code (noexec), set TMPDIR to one that does.',
    { cause: error },
  )
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

if (platform === 'linux-x64' && !sharp._isUsingX64V2()) {
  throw new Error("sharp's Linux x64 binaries need a CPU with the x86-64-v2 instructions")
}

export default sharp
