// The database a command works on, the one `start` would use: DATABASE_PATH, else on a server
// `logspace deploy` set up, the service's, else data/app.sqlite. Its layer opens it.
import { Config, Effect, FileSystem, Layer, Option } from 'effect'

import { AppConfig } from '../lib/config.ts'
import { DatabaseLive } from '../lib/database.ts'
import { DOMAINS_FILE, SERVER_DATABASE_PATH } from './deploy.ts'

export const commandDatabase = Effect.gen(function* () {
  let fs = yield* FileSystem.FileSystem
  let config = yield* Effect.provide(AppConfig, AppConfig.layer)
  let databasePathSet = Option.isSome(yield* Config.option(Config.String('DATABASE_PATH')))
  let onServer = !databasePathSet && (yield* fs.exists(DOMAINS_FILE))
  let file = onServer ? SERVER_DATABASE_PATH : config.databasePath
  let exists = file === ':memory:' || (yield* fs.exists(file))
  let layer = DatabaseLive.pipe(
    Layer.provide(Layer.succeed(AppConfig, { ...config, databasePath: file })),
  )
  return { file, exists, layer }
})
