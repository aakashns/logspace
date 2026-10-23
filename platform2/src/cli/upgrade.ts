// `logspace upgrade [version] [--yes]`: replaces this binary with the latest release, or the given
// one, from GitHub, checked against the release's SHA256SUMS. When it's the binary a server's
// service runs (see setup.ts), it then runs the new one's setup, which installs its service file
// and restarts the app.
import * as fs from 'node:fs'
import * as path from 'node:path'
import { Console, Effect } from 'effect'

import { runsService } from './setup.ts'
import { fail, IS_BINARY, VERSION } from './shell.ts'

// Where releases are published.
const RELEASES_URL =
  process.env.LOGSPACE_RELEASES_URL || 'https://github.com/aakashns/logspace/releases'
// The platforms there's a release binary for, logspace-<platform>-<arch>.
const TARGETS = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64']

export const upgrade = Effect.fn('upgrade')(function* (
  requested: string | undefined,
  yes: boolean,
) {
  if (!IS_BINARY)
    return yield* fail('upgrade replaces the built binary. In a checkout, pull and build instead.')
  let target = `${process.platform}-${process.arch}`
  if (!TARGETS.includes(target)) return yield* fail(`There are no releases for ${target}`)

  let version = (requested ?? (yield* latestTag)).replace(/^v/, '')
  if (!/^\d+\.\d+\.\d+$/.test(version)) return yield* fail(`Not a release: ${version}`)
  let order = compareVersions(version, VERSION)
  if (order === 0 || (order < 0 && requested === undefined)) {
    return yield* Console.log(`LogSpace ${VERSION} is up to date`)
  }
  if (order < 0) {
    return yield* fail(
      `${version} is older than ${VERSION}, and its server might not work with the database this one migrated`,
    )
  }

  let binary = process.execPath
  try {
    fs.accessSync(path.dirname(binary), fs.constants.W_OK)
  } catch {
    return yield* fail(`Can't replace ${binary}. Run it as a user who can, e.g. with sudo.`)
  }
  if (!yes && !confirm(`Replace LogSpace ${VERSION} at ${binary} with ${version}?`)) {
    return yield* fail('Cancelled')
  }

  let asset = `logspace-${target}`
  let releaseUrl = `${RELEASES_URL}/download/v${version}`
  yield* Console.log(`Downloading ${releaseUrl}/${asset}...`)
  let sums = new TextDecoder().decode(yield* download(`${releaseUrl}/SHA256SUMS`))
  // sha256sum writes "<hash>  <name>", or "<hash> *<name>" for a file it read as binary.
  let expected = sums
    .split('\n')
    .map((line) => line.trim().split(/\s+\*?/))
    .find(([, name]) => name === asset)?.[0]
  if (!expected) return yield* fail(`${version}'s SHA256SUMS doesn't list ${asset}`)
  let bytes = yield* download(`${releaseUrl}/${asset}`)
  if (new Bun.CryptoHasher('sha256').update(bytes).digest('hex') !== expected) {
    return yield* fail(`The downloaded ${asset} doesn't match ${version}'s SHA256SUMS`)
  }

  // Written beside it and moved into place, so a running server keeps its copy.
  let tmp = `${binary}.${process.pid}.tmp`
  try {
    fs.writeFileSync(tmp, bytes)
    fs.chmodSync(tmp, 0o755)
    fs.renameSync(tmp, binary)
  } finally {
    fs.rmSync(tmp, { force: true })
  }
  yield* Console.log(`Upgraded LogSpace ${VERSION} to ${version}`)

  if (!runsService(binary)) return yield* Console.log('Restart LogSpace to run it')
  let setup = Bun.spawnSync([binary, 'setup'], { stdio: ['inherit', 'inherit', 'inherit'] })
  if (!setup.success)
    return yield* fail(`The new version's setup didn't finish. Run sudo logspace setup again.`)
})

const request = (url: string, init?: RequestInit) =>
  Effect.tryPromise({
    try: () => fetch(url, init),
    catch: (error) =>
      fail(`Couldn't reach ${url}: ${error instanceof Error ? error.message : error}`),
  })

// The latest release's tag, from where GitHub sends /releases/latest (/releases/tag/<tag>).
const latestTag = Effect.gen(function* () {
  let url = `${RELEASES_URL}/latest`
  let response = yield* request(url, { redirect: 'manual' })
  let tag = /\/releases\/tag\/([^/?#]+)$/.exec(response.headers.get('Location') ?? '')?.[1]
  if (!tag) return yield* fail(`Couldn't find the latest release at ${url}`)
  return decodeURIComponent(tag)
})

const download = (url: string) =>
  Effect.gen(function* () {
    let response = yield* request(url)
    if (!response.ok) return yield* fail(`Couldn't download ${url}: HTTP ${response.status}`)
    return new Uint8Array(yield* Effect.promise(() => response.arrayBuffer()))
  })

// Orders two versions like 0.12.3, both from release tags or package.json.
function compareVersions(a: string, b: string): number {
  let [x, y] = [a, b].map((version) => version.split('.').map(Number))
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}
