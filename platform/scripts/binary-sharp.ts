// Loads sharp's native addon in the binary, in place of sharp's own loader (scripts/build.ts swaps
// it in), which looks for it in node_modules. The addon and libvips, the library it links to, are
// embedded in the binary, but a library can only be loaded from a real file, and the addon finds
// libvips by a path relative to its own, so both are copied into a private temporary folder in
// the layout node_modules/@img has, loaded, and deleted (a loaded library stays loaded).
import * as fs from 'node:fs'
import { createRequire } from 'node:module'
import * as os from 'node:os'
import * as path from 'node:path'

// Made by scripts/build.ts: each embedded file's path in the binary, and where it goes.
import files from 'logspace:sharp-files'

let tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logspace-sharp-'))
let sharp
try {
  let addon = ''
  for (let { embedded, layout } of files) {
    let target = path.join(tmpDir, layout)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, await Bun.file(embedded).bytes())
    if (target.endsWith('.node')) addon = target
  }
  sharp = createRequire(import.meta.url)(addon)
} catch (error) {
  throw new Error(
    `Couldn't load sharp's native addon from ${tmpDir}. If the temporary folder doesn't allow ` +
      'running code (noexec), set TMPDIR to one that does.',
    { cause: error },
  )
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

if (process.platform === 'linux' && process.arch === 'x64' && !sharp._isUsingX64V2()) {
  throw new Error("sharp's Linux x64 binaries need a CPU with the x86-64-v2 instructions")
}

export default sharp
