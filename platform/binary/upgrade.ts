// `logspace upgrade [version] [--yes]`: replaces this binary with the latest release, or the given
// one, from GitHub, checked against the release's SHA256SUMS. When it's the binary `logspace
// setup` installed on a server, it then runs the new one's setup, which installs its service
// file and restarts the app.
import { spawnSync } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { CommandError, IS_BINARY, VERSION } from './command.ts'
import { BINARY_PATH, DOMAINS_FILE } from './setup.ts'

// Where releases are published. smoke-test.ts points it at pretend ones.
const RELEASES_URL =
  process.env.LOGSPACE_RELEASES_URL || 'https://github.com/aakashns/logspace/releases'
// The platforms there's a release binary for, logspace-<platform>-<arch> (see release.yml).
const TARGETS = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64']

export async function upgrade(args: string[]): Promise<void> {
  let yes = false
  let requested: string | undefined
  for (let arg of args) {
    if (arg === '--yes' || arg === '-y') yes = true
    else if (requested === undefined && !arg.startsWith('-')) requested = arg
    else throw new CommandError(`Unexpected argument: ${arg}`)
  }
  if (!IS_BINARY) {
    throw new CommandError(
      'upgrade replaces the built binary. In a checkout, pull and build instead.',
    )
  }
  let target = `${process.platform}-${process.arch}`
  if (!TARGETS.includes(target)) throw new CommandError(`There are no releases for ${target}`)

  let version = (requested ?? (await latestTag())).replace(/^v/, '')
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new CommandError(`Not a release: ${version}`)
  let order = compareVersions(version, VERSION)
  if (order === 0 || (order < 0 && requested === undefined)) {
    console.log(`LogSpace ${VERSION} is up to date`)
    return
  }
  if (order < 0) {
    throw new CommandError(
      `${version} is older than ${VERSION}, and its server might not work with the database ` +
        'this one migrated',
    )
  }

  let binary = process.execPath
  try {
    fs.accessSync(path.dirname(binary), fs.constants.W_OK)
  } catch {
    throw new CommandError(`Can't replace ${binary}. Run it as a user who can, e.g. with sudo.`)
  }
  if (!yes && !confirm(`Replace LogSpace ${VERSION} at ${binary} with ${version}?`)) {
    throw new CommandError('Cancelled')
  }

  let asset = `logspace-${target}`
  let releaseUrl = `${RELEASES_URL}/download/v${version}`
  console.log(`Downloading ${releaseUrl}/${asset}...`)
  let sums = new TextDecoder().decode(await download(`${releaseUrl}/SHA256SUMS`))
  // sha256sum writes "<hash>  <name>", or "<hash> *<name>" for a file it read as binary.
  let expected = sums
    .split('\n')
    .map((line) => line.trim().split(/\s+\*?/))
    .find(([, name]) => name === asset)?.[0]
  if (!expected) throw new CommandError(`${version}'s SHA256SUMS doesn't list ${asset}`)
  let bytes = await download(`${releaseUrl}/${asset}`)
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== expected) {
    throw new CommandError(`The downloaded ${asset} doesn't match ${version}'s SHA256SUMS`)
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
  console.log(`Upgraded LogSpace ${VERSION} to ${version}`)

  let installed =
    fs.existsSync(DOMAINS_FILE) &&
    fs.existsSync(BINARY_PATH) &&
    fs.realpathSync(binary) === fs.realpathSync(BINARY_PATH)
  if (!installed) {
    console.log('Restart LogSpace to run it')
    return
  }
  let setup = spawnSync(binary, ['setup'], { stdio: 'inherit' })
  if (setup.status !== 0) {
    throw new CommandError(`The new version's setup didn't finish. Run sudo logspace setup again.`)
  }
}

// The latest release's tag, from where GitHub sends /releases/latest (/releases/tag/<tag>).
async function latestTag(): Promise<string> {
  let url = `${RELEASES_URL}/latest`
  let response = await request(url, { redirect: 'manual' })
  let tag = /\/releases\/tag\/([^/?#]+)$/.exec(response.headers.get('Location') ?? '')?.[1]
  if (!tag) throw new CommandError(`Couldn't find the latest release at ${url}`)
  return decodeURIComponent(tag)
}

async function download(url: string): Promise<Uint8Array> {
  let response = await request(url)
  if (!response.ok) throw new CommandError(`Couldn't download ${url}: HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

async function request(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (error) {
    throw new CommandError(
      `Couldn't reach ${url}: ${error instanceof Error ? error.message : error}`,
    )
  }
}

// Orders two versions like 0.12.3, both from release tags or package.json.
function compareVersions(a: string, b: string): number {
  let [x, y] = [a, b].map((version) => version.split('.').map(Number))
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}
