// A fake privileged worker for browser tests. All state remains in the fixture directory.
import { Clock, Effect, FileSystem, Layer, Schema } from 'effect'
import { join } from 'node:path'
import { Updates } from '../src/lib/updates.ts'
import { VERSION } from '../src/lib/version.ts'

const State = Schema.Struct({
  enabled: Schema.Boolean,
  pending: Schema.Boolean,
  current: Schema.String,
  latest: Schema.String,
  message: Schema.optionalKey(Schema.String),
  failed: Schema.optionalKey(Schema.Boolean),
})
export const browserUpdates = (directory: string) =>
  Layer.effect(
    Updates,
    Effect.gen(function* () {
      let fs = yield* FileSystem.FileSystem
      let file = join(directory, 'updates.json')
      if (!(yield* fs.exists(file)))
        yield* fs.writeFileString(
          file,
          JSON.stringify({ enabled: false, pending: false, current: VERSION, latest: '99.0.0' }),
        )
      let read = fs
        .readFileString(file)
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(State))),
          Effect.orDie,
        )
      let save = (value: typeof State.Type) =>
        fs.writeFileString(file, JSON.stringify(value)).pipe(Effect.orDie)
      return Updates.of({
        status: Effect.gen(function* () {
          let state = yield* read
          return {
            ...state,
            managed: true,
            result: state.message
              ? {
                  state: state.failed ? 'error' : 'done',
                  message: state.message,
                  checkedAt: yield* Clock.currentTimeMillis,
                }
              : undefined,
          }
        }),
        request: Effect.gen(function* () {
          yield* save({ ...(yield* read), pending: true })
        }),
        setEnabled: (enabled) =>
          Effect.gen(function* () {
            yield* save({ ...(yield* read), enabled })
          }),
      })
    }),
  )
