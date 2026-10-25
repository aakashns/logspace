// Reading the `users` and `verifications` tables. Writing them goes through commands.ts.
import { DateTime, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { signUpEmail, type User } from './user.ts'

// The address the code with that id was emailed to, while it can still be entered.
export const pendingSignUpEmail = Effect.fn('pendingSignUpEmail')(function* (id: string) {
  let sql = yield* SqlClient.SqlClient
  let now = DateTime.formatIso(yield* DateTime.now)
  let [row] = yield* sql<{ identifier: string }>`select identifier from verifications
    where id = ${id} and expires_at > ${now}`.pipe(Effect.orDie)
  return row ? signUpEmail(row.identifier) : undefined
})

// Everyone with an account, newest first. For now, that's everyone subscribed.
export const allUsers = Effect.gen(function* () {
  let sql = yield* SqlClient.SqlClient
  return yield* sql<User>`select id, name, email, created_at as "createdAt" from users
    order by created_at desc, email`.pipe(Effect.orDie)
}).pipe(Effect.withSpan('allUsers'))
