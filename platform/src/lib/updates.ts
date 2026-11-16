// The unprivileged app can request one fixed operation. Only the root-owned systemd job
// replaces the binary; its result lives outside the app's writable directories.
import { HttpClient } from 'effect/http'
import { Clock, Config, Context, Effect, FileSystem, Layer, Schema } from 'effect'

import { latestRelease } from './releases.ts'
import { compareVersions, VERSION } from './version.ts'

export const UPDATE_REQUEST = '/var/lib/logspace/update-request'
export const AUTO_UPDATE = '/var/lib/logspace/auto-update'
export const UPDATE_STATUS = '/var/lib/logspace-updater/status.json'
export const UpdateResult = Schema.Struct({
  state: Schema.Literals(['checking', 'updating', 'done', 'error']),
  message: Schema.String,
  checkedAt: Schema.Number,
})
export type UpdateResult = typeof UpdateResult.Type
export interface UpdateStatus {
  current: string
  latest?: string | undefined
  error?: string | undefined
  managed: boolean
  enabled: boolean
  pending: boolean
  result?: UpdateResult | undefined
}
export class UpdatesUnavailable extends Schema.TaggedError<UpdatesUnavailable>()(
  'UpdatesUnavailable',
  { message: Schema.String },
) {}

export class Updates extends Context.Service<
  Updates,
  {
    readonly status: Effect.Effect<UpdateStatus>
    readonly request: Effect.Effect<void, UpdatesUnavailable>
    readonly setEnabled: (enabled: boolean) => Effect.Effect<void, UpdatesUnavailable>
  }
>()('logspace/Updates') {
  static readonly layer = Layer.effect(
    Updates,
    Effect.gen(function* () {
      let fs = yield* FileSystem.FileSystem
      let http = yield* HttpClient.HttpClient
      let managed = yield* Config.Boolean('LOGSPACE_MANAGED_UPDATES').pipe(
        Config.withDefault(false),
        Effect.orDie,
      )
      let release = yield* latestRelease().pipe(
        Effect.provideService(HttpClient.HttpClient, http),
        Effect.match({
          onSuccess: (latest) => ({ latest, error: undefined }),
          onFailure: (error) => ({ latest: undefined, error: error.message }),
        }),
        Effect.cachedWithTTL('1 hour'),
      )
      let allowed = managed
        ? Effect.void
        : Effect.fail(
            new UpdatesUnavailable({
              message: 'Run sudo logspace deploy with this version to enable managed updates.',
            }),
          )
      let status: Effect.Effect<UpdateStatus> = Effect.gen(function* () {
        let result =
          managed && (yield* fs.exists(UPDATE_STATUS))
            ? yield* fs
                .readFileString(UPDATE_STATUS)
                .pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(UpdateResult))),
                  Effect.orDie,
                )
            : undefined
        if (
          result &&
          ['checking', 'updating'].includes(result.state) &&
          (yield* Clock.currentTimeMillis) - result.checkedAt > 16 * 60 * 1000
        ) {
          result = {
            ...result,
            state: 'error',
            message:
              'The update job stopped responding. Check journalctl -u logspace-update, then try again.',
          }
        }
        return {
          current: VERSION,
          managed,
          enabled: managed && (yield* fs.exists(AUTO_UPDATE)),
          pending: managed && (yield* fs.exists(UPDATE_REQUEST)),
          result,
          // Checkout/test servers don't contact GitHub while rendering settings.
          ...(managed ? yield* release : {}),
        }
      }).pipe(Effect.orDie)
      return Updates.of({
        status,
        request: Effect.gen(function* () {
          yield* allowed
          let current = yield* status
          if (
            current.pending ||
            current.result?.state === 'updating' ||
            current.result?.state === 'checking'
          )
            return
          if (!current.latest)
            return yield* new UpdatesUnavailable({
              message: current.error ?? 'Check for updates first.',
            })
          if (compareVersions(current.latest, VERSION) <= 0) return
          // The path unit consumes this marker. Repeated submissions coalesce into one job.
          yield* fs.writeFileString(UPDATE_REQUEST, '').pipe(Effect.orDie)
        }),
        setEnabled: (enabled) =>
          Effect.gen(function* () {
            yield* allowed
            yield* (
              enabled
                ? fs.writeFileString(AUTO_UPDATE, '')
                : fs.remove(AUTO_UPDATE, { force: true })
            ).pipe(Effect.orDie)
          }),
      })
    }),
  )
}
