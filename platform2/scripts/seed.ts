// Fills the database and media storage that the environment names (DATABASE_PATH, MEDIA_DIR)
// with the sample posts the tests use, replacing any posts already there: for trying the app
// locally, and for the benchmarks.
//
//   DATABASE_PATH=data/app.sqlite MEDIA_DIR=data/media bun scripts/seed.ts
import { Effect, Layer } from 'effect'

import { AppServices } from '../src/app.ts'
import { AppConfig } from '../src/config.ts'
import { seedDatabase, seedMedia } from '../test/seed.ts'

await Effect.runPromise(
  Effect.andThen(seedMedia, seedDatabase).pipe(
    Effect.provide(AppServices.pipe(Layer.provide(AppConfig.layer))),
  ),
)
console.log('Seeded the sample posts')
