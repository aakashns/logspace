import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

// The root of the binary's embedded file system, where build.ts embeds files at their paths in
// the app.
export const EMBEDDED_ROOT = fileURLToPath(new URL('../', import.meta.url))

// Copies an embedded folder to disk. Embedded files can only be read whole (not streamed, copied,
// or opened), so anything that needs a real file gets a copy.
export function copyEmbeddedDir(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true })
  for (let name of fs.readdirSync(from)) {
    let source = path.join(from, name)
    let target = path.join(to, name)
    if (fs.statSync(source).isDirectory()) copyEmbeddedDir(source, target)
    else fs.writeFileSync(target, fs.readFileSync(source))
  }
}
