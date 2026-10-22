import { db, migrateDatabase } from './app/data/db.ts'
import { router } from './app/router.ts'

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 44100
// Set when running behind a reverse proxy that overwrites X-Forwarded-* headers (e.g. Caddy)
const trustProxy = process.env.TRUST_PROXY === '1'

// The one Bun API the server uses. Bun's own types change the global Blob and File in ways the
// app's code doesn't match, so they're left out of tsconfig.json (see binary/tsconfig.json).
declare const Bun: {
  serve(options: { port: number; fetch(request: Request): Promise<Response> }): {
    port: number
    stop(closeActiveConnections?: boolean): Promise<void>
  }
}

await migrateDatabase()

const server = Bun.serve({
  port,
  fetch: (request) => router.fetch(trustProxy ? withForwardedUrl(request) : request),
})

console.log(`Server listening on http://localhost:${server.port}`)

// Behind the proxy the request arrives over plain HTTP, so its URL is rebuilt from the protocol
// and host the browser used, which the proxy forwards. Pages, links, and cop()'s same-origin check
// depend on it.
function withForwardedUrl(request: Request): Request {
  let url = new URL(request.url)
  let protocol = firstValue(request.headers.get('X-Forwarded-Proto'))?.toLowerCase()
  if (protocol !== 'http' && protocol !== 'https') protocol = url.protocol.slice(0, -1)
  let host = firstValue(request.headers.get('X-Forwarded-Host')) ?? url.host
  // Built whole: setting a URL's host keeps its port when the new one has none.
  let forwarded = URL.parse(`${url.pathname}${url.search}`, `${protocol}://${host}`)
  return forwarded ? new Request(forwarded, request) : request
}

function firstValue(header: string | null): string | undefined {
  return header?.split(',', 1)[0].trim() || undefined
}

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
