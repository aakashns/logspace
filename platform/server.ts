import * as http from 'node:http'
import { createRequestListener } from 'remix/node-fetch-server'

import { db, migrateDatabase } from './app/data/db.ts'
import { router } from './app/router.ts'

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 44100
const hmrProxyPort = process.env.HMR_PROXY_PORT
  ? Number.parseInt(process.env.HMR_PROXY_PORT, 10)
  : null
const isHmr = process.env.REMIX_NODE_HMR === '1'
// Set when running behind a reverse proxy that overwrites X-Forwarded-* headers (e.g. Caddy)
const trustProxy = isHmr || process.env.TRUST_PROXY === '1'

await migrateDatabase()

const server = http.createServer(createRequestListener(router.fetch, { trustProxy }))

server.listen(port, () => {
  if (isHmr) {
    import('remix/node-hmr/runtime').then((nodeHmr) => nodeHmr.emitServerReady())
  }

  console.log(`Server listening on http://localhost:${hmrProxyPort ?? port}`)
})

let shuttingDown = false

function shutdown() {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  server.close(() => db.close().finally(() => process.exit(0)))
  server.closeAllConnections()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
