import { db, migrateDatabase } from './app/data/db.ts'
import { withForwardedUrl } from './app/lib/forwarded.ts'
import { router } from './app/router.ts'

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 44100
// Set when running behind a reverse proxy that overwrites the Forwarded and X-Forwarded-* headers
// (e.g. Caddy)
const trustProxy = process.env.TRUST_PROXY === '1'

// The one Bun API the server uses. Bun's own types change the global Blob and File in ways the
// app's code doesn't match, so they're left out of tsconfig.json (see binary/tsconfig.json).
declare const Bun: {
  serve(options: {
    port: number
    fetch(request: Request): Promise<Response>
    development: boolean
    idleTimeout: number
  }): {
    port: number
    stop(closeActiveConnections?: boolean): Promise<void>
  }
}

await migrateDatabase()

const server = Bun.serve({
  port,
  fetch: (request) => router.fetch(withForwardedUrl(request, { trustProxy })),
  // In development mode Bun answers an error with a page of the stack and the code around it. It
  // goes by NODE_ENV when the server starts, which the binary doesn't need set (its NODE_ENV is
  // built in, see binary/build.ts), so it's set here, where the build's value applies.
  development: process.env.NODE_ENV !== 'production',
  // Bun closes a connection after 10 seconds without sending or receiving anything by default,
  // even while a response is being made, like a slow read from S3 or a big photo's first resize.
  // 255 seconds is its longest.
  idleTimeout: 255,
})

console.log(`Server listening on http://localhost:${server.port}`)

let shuttingDown = false

async function shutdown() {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  await server.stop(true)
  await db.close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
