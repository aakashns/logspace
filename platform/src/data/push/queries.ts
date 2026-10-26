// Reading the `push_subscriptions` table. Writing it goes through commands.ts.
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { getPushService, type PushSubscriber } from './push.ts'

// Every browser subscribed, newest first.
export const allPushSubscribers = Effect.gen(function* () {
  let sql = yield* SqlClient.SqlClient
  let rows = yield* sql<{
    endpoint: string
    created_at: string
    last_sent_at: string | null
    last_error: string | null
    failures: number
  }>`select endpoint, created_at, last_sent_at, last_error, failures from push_subscriptions
    order by created_at desc, endpoint`.pipe(Effect.orDie)
  return rows.map((row): PushSubscriber => ({
    service: getPushService(row.endpoint),
    createdAt: row.created_at,
    lastSentAt: row.last_sent_at ?? undefined,
    lastError: row.last_error ?? undefined,
    failures: row.failures,
  }))
}).pipe(Effect.withSpan('allPushSubscribers'))
