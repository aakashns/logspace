// `logspace start`: runs the same server as `bun server.ts`, but a binary has no checkout to keep
// its data in, so the database, media, and caches default to data/ in the working directory
// instead.
import * as fs from 'node:fs'
import * as path from 'node:path'

import { VERSION } from './command.ts'
import { copyEmbeddedDir, EMBEDDED_ROOT } from './embedded.ts'

export async function start(): Promise<void> {
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
}
