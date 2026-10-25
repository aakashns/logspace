// Reading the `users` and `verifications` tables. Writing them goes through commands.ts.
import { DateTime, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { signUpEmail } from './user.ts'

// The address a sign-up's code (by its row's id) was emailed to, while it can still be entered.
export const pendingSignUpEmail = Effect.fn('pendingSignUpEmail')(function* (id: string) {
  let sql = yield* SqlClient.SqlClient
  let now = DateTime.formatIso(yield* DateTime.now)
  let [row] = yield* sql<{ identifier: string }>`select identifier from verifications
    where id = ${id} and expires_at > ${now}`.pipe(Effect.orDie)
  return row ? signUpEmail(row.identifier) : undefined
})
