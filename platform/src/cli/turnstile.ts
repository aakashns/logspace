// `logspace turnstile on|off`: whether logging in to /admin requires Cloudflare Turnstile, the
// Enabled checkbox in /admin/integrations. Off is the way back in when Turnstile locks the admin
// out, and pauses subscribing, which always requires it. The server reads it on every request,
// so it needn't restart.
import { Console, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { commandDatabase } from './database.ts'
import { fail, reportFailures } from './shell.ts'

export const turnstile = Effect.fn('turnstile')(function* (state: 'on' | 'off') {
  let { file, exists, layer } = yield* commandDatabase
  if (!exists) return yield* fail(`There's no database at ${file}`)
  let updated = yield* Effect.gen(function* () {
    let sql = yield* SqlClient.SqlClient
    return yield* sql`update config set value = json_set(value, '$.enabled', json(${state === 'on' ? 'true' : 'false'}))
      where key = 'turnstile' returning key`
  }).pipe(
    Effect.provide(layer),
    Effect.catchTag('SqlError', (error) =>
      Effect.fail(fail(`Couldn't change ${file}: ${error.message}`)),
    ),
  )
  if (updated.length === 0) {
    if (state === 'off') return yield* Console.log('Turnstile isn’t set up, so it’s already off.')
    return yield* fail('Turnstile isn’t set up. Save its keys at /admin/integrations first.')
  }
  yield* Console.log(
    state === 'on'
      ? 'Turnstile is on: logging in to /admin requires passing it.'
      : 'Turnstile is off: logging in to /admin needs only the password. Subscribing, if it’s on, is paused.',
  )
}, reportFailures)
