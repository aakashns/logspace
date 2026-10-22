// The logspace binary's entry point (see build.ts). It runs the same server as `bun server.ts`, but
// a binary has no checkout to keep its data in, so the database, media, and caches default to
// data/ in the working directory instead.
import * as fs from 'node:fs'
import * as path from 'node:path'

import { copyEmbeddedDir, EMBEDDED_ROOT } from './embedded.ts'

const VERSION = process.env.LOGSPACE_VERSION ?? 'dev'

let [command] = process.argv.slice(2)
if (command === '--version' || command === '-v') {
  console.log(VERSION)
  process.exit(0)
}
if (command !== undefined) {
  console.log(`LogSpace ${VERSION}

Usage: logspace [--version]

Starts the server. It's configured with environment variables (see the README), including:
  PORT              the port to listen on (44100)
  DATABASE_PATH     the SQLite database (data/app.sqlite)
  MEDIA_DIR         the folder for uploaded media (data/media)
  CACHE_DIR         the folder for caches (data/cache)
  ADMIN_PASSWORD, AUTH_SESSION_SECRET
                    the admin password and the secret that signs its session cookie`)
  process.exit(command === '--help' || command === '-h' ? 0 : 1)
}

process.env.DATABASE_PATH ??= path.resolve('data/app.sqlite')
process.env.MEDIA_DIR ??= path.resolve('data/media')
process.env.CACHE_DIR ??= path.resolve('data/cache')

// The static file middleware streams files, which embedded ones can't be, so public/ is served
// from a copy in the cache folder, written out afresh at every start.
process.env.PUBLIC_DIR = path.join(process.env.CACHE_DIR, 'public')
fs.rmSync(process.env.PUBLIC_DIR, { recursive: true, force: true })
copyEmbeddedDir(path.join(EMBEDDED_ROOT, 'public'), process.env.PUBLIC_DIR)

console.log(`LogSpace ${VERSION}`)
await import('../server.ts')
