// `logspace upgrade [version] [--yes]`: replaces this binary with the latest release, or the given
// one, from GitHub, checked against the release's SHA256SUMS. That's all it does: migrating the
// database and restarting the server are left to `logspace migrate` and whatever runs it.
import { Config, Console, Effect, FileSystem, Path } from 'effect'
import { Prompt } from 'effect/cli'
import { FetchHttpClient, HttpClient } from 'effect/http'

import { fail, IS_BINARY, reportFailures, VERSION } from './shell.ts'

// Where releases are published.
const DEFAULT_RELEASES_URL = 'https://github.com/aakashns/logspace/releases'
const releasesUrl = Config.String('LOGSPACE_RELEASES_URL').pipe(
  Config.withDefault(DEFAULT_RELEASES_URL),
  Config.map((url) => url || DEFAULT_RELEASES_URL),
)
// The platforms there's a release binary for, logspace-<platform>-<arch>.
const TARGETS = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64']

export const upgrade = Effect.fn('upgrade')(
  function* (requested: string | undefined, yes: boolean) {
    if (!IS_BINARY) {
      return yield* fail(
        'upgrade replaces the built binary. In a checkout, pull and build instead.',
      )
    }
    let target = `${process.platform}-${process.arch}`
    if (!TARGETS.includes(target)) return yield* fail(`There are no releases for ${target}`)
    // A string with a default can't fail to read.
    let releases = yield* Effect.orDie(releasesUrl)

    let version = (requested ?? (yield* latestTag(releases))).replace(/^v/, '')
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

    let fs = yield* FileSystem.FileSystem
    let path = yield* Path.Path
    let binary = process.execPath
    yield* fs
      .access(path.dirname(binary), { writable: true })
      .pipe(
        Effect.mapError(() =>
          fail(`Can't replace ${binary}. Run it as a user who can, e.g. with sudo.`),
        ),
      )
    if (!yes) {
      let confirmed = yield* Prompt.run(
        Prompt.Confirm({ message: `Replace LogSpace ${VERSION} at ${binary} with ${version}?` }),
      ).pipe(Effect.catchTag('QuitError', () => Effect.succeed(false)))
      if (!confirmed) return yield* fail('Cancelled')
    }

    let asset = `logspace-${target}`
    let releaseUrl = `${releases}/download/v${version}`
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
    yield* Effect.gen(function* () {
      yield* fs.writeFile(tmp, bytes)
      yield* fs.chmod(tmp, 0o755)
      yield* fs.rename(tmp, binary)
    }).pipe(Effect.ensuring(fs.remove(tmp, { force: true }).pipe(Effect.orDie)))
    yield* Console.log(`Upgraded LogSpace ${VERSION} to ${version}`)
    yield* Console.log('Run logspace migrate, then restart LogSpace to run it')
    yield* Console.log(
      'For a service installed by setup, run sudo logspace setup to apply the current service defaults',
    )
  },
  reportFailures,
  Effect.provide(FetchHttpClient.layer),
)

// The latest release's tag, from where GitHub sends /releases/latest (/releases/tag/<tag>).
const latestTag = Effect.fnUntraced(function* (releases: string) {
  let url = `${releases}/latest`
  let response = yield* (yield* HttpClient.HttpClient).get(url).pipe(
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: 'manual' }),
    Effect.mapError((error) => fail(`Couldn't reach ${url}: ${error.message}`)),
  )
  let tag = /\/releases\/tag\/([^/?#]+)$/.exec(response.headers['location'] ?? '')?.[1]
  if (!tag) return yield* fail(`Couldn't find the latest release at ${url}`)
  return decodeURIComponent(tag)
})

const download = Effect.fnUntraced(function* (url: string) {
  let response = yield* (yield* HttpClient.HttpClient)
    .get(url)
    .pipe(Effect.mapError((error) => fail(`Couldn't reach ${url}: ${error.message}`)))
  if (response.status < 200 || response.status >= 300) {
    return yield* fail(`Couldn't download ${url}: HTTP ${response.status}`)
  }
  let body = yield* response.arrayBuffer.pipe(
    Effect.mapError((error) => fail(`Couldn't download ${url}: ${error.message}`)),
  )
  return new Uint8Array(body)
})

// Orders two versions like 0.12.3, both from release tags or package.json.
function compareVersions(a: string, b: string): number {
  let x = a.split('.').map(Number)
  let y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    let difference = (x[i] ?? 0) - (y[i] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}
