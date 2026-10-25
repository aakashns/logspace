// Reading the `users` and `verifications` tables. Writing them goes through commands.ts.
import { DateTime, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { signUpIdentifier } from './user.ts'

// Whether there's a code emailed to the address that can still be entered.
export const hasPendingSignUp = Effect.fn('hasPendingSignUp')(function* (email: string) {
  let sql = yield* SqlClient.SqlClient
  let now = DateTime.formatIso(yield* DateTime.now)
  let rows = yield* sql`select 1 from verifications
    where identifier = ${signUpIdentifier(email)} and expires_at > ${now}`.pipe(Effect.orDie)
  return rows.length > 0
})
