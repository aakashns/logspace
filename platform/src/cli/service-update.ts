// The systemd job runs outside the app's cgroup. Markers never supply commands or URLs.
import { Clock, Effect, FileSystem } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { latestRelease } from '../lib/releases.ts'
import { AUTO_UPDATE, UPDATE_REQUEST, UPDATE_STATUS, type UpdateResult } from '../lib/updates.ts'
import { compareVersions, VERSION } from '../lib/version.ts'
import { fail, IS_BINARY, reportFailures, requireRoot, run } from './shell.ts'
import { upgrade } from './upgrade.ts'

export const updatePaths = { request: UPDATE_REQUEST, enabled: AUTO_UPDATE, status: UPDATE_STATUS }
export const performServiceUpdate = Effect.fn('performServiceUpdate')(function* <
  E,
  R,
  E2,
  R2,
  E3,
  R3,
>(
  actions: {
    latest: Effect.Effect<string, E, R>
    install: Effect.Effect<void, E2, R2>
    deploy: Effect.Effect<void, E3, R3>
  },
  paths = updatePaths,
) {
  let fs = yield* FileSystem.FileSystem
  let manual = yield* fs.exists(paths.request)
  if (!manual && !(yield* fs.exists(paths.enabled))) return
  if (manual) yield* fs.remove(paths.request, { force: true })
  let checkedAt = yield* Clock.currentTimeMillis
  let write = (state: UpdateResult['state'], message: string) =>
    Effect.gen(function* () {
      let tmp = `${paths.status}.tmp`
      yield* fs.writeFileString(tmp, JSON.stringify({ state, message, checkedAt }), { mode: 0o644 })
      yield* fs.rename(tmp, paths.status)
    })
  yield* Effect.gen(function* () {
    yield* write('checking', 'Checking for updates…')
    let latest = yield* actions.latest
    if (compareVersions(latest, VERSION) <= 0) {
      yield* write('done', `LogSpace ${VERSION} is up to date.`)
      return
    }
    yield* write(
      'updating',
      `Updating to ${latest}. The service will restart; reconnecting automatically…`,
    )
    yield* actions.install
    yield* actions.deploy
    yield* write('done', `Updated to LogSpace ${latest}.`)
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        yield* Effect.logError('Service update failed', cause)
        yield* write('error', 'Update failed. See journalctl -u logspace-update, then try again.')
      }),
    ),
  )
})
export const serviceUpdate = Effect.gen(function* () {
  yield* requireRoot
  if (!IS_BINARY) return yield* fail('service-update requires the installed binary')
  yield* performServiceUpdate({
    latest: latestRelease(),
    install: upgrade(undefined, true),
    deploy: run(process.execPath, 'deploy'),
  })
}).pipe(reportFailures, Effect.provide(FetchHttpClient.layer))
