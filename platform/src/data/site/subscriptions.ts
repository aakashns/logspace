// Whether people can subscribe at /subscribe: the switch at /admin/subscribers is on, and what
// subscribing needs is there: email, to send the code that proves an address is theirs, and
// Turnstile, enabled, to keep bots from making them send it. While either isn't, subscribing is
// paused, and the switch stays as it was, so it's open again once they're back.
import { Effect } from 'effect'

import { Email } from './email.ts'
import { SiteConfigQueries } from './queries.ts'
import { Turnstile } from './turnstile.ts'

// What subscribing needs that isn't there.
export const SUBSCRIPTIONS_BLOCKERS = [
  'EmailNotSetUp',
  'EmailSecretUnreadable',
  'TurnstileNotSetUp',
  'TurnstileSecretUnreadable',
  'TurnstileNotEnabled',
] as const
export type SubscriptionsBlocker = (typeof SUBSCRIPTIONS_BLOCKERS)[number]

// Off can be switched on once nothing's missing. Open has Turnstile's site key, for the widget.
export type SubscriptionsStatus =
  | { readonly _tag: 'Off'; readonly missing: readonly SubscriptionsBlocker[] }
  | { readonly _tag: 'Paused'; readonly missing: readonly SubscriptionsBlocker[] }
  | { readonly _tag: 'Open'; readonly siteKey: string }

export const subscriptionsStatus = Effect.gen(function* () {
  let enabled = (yield* (yield* SiteConfigQueries).saved).subscriptions?.enabled ?? false
  let email = yield* (yield* Email).status
  let turnstile = yield* (yield* Turnstile).status
  let missing: SubscriptionsBlocker[] = []
  if (email._tag === 'NotSetUp') missing.push('EmailNotSetUp')
  if (email._tag === 'SecretUnreadable') missing.push('EmailSecretUnreadable')
  if (turnstile._tag === 'NotSetUp') missing.push('TurnstileNotSetUp')
  else if (turnstile._tag === 'SecretUnreadable') missing.push('TurnstileSecretUnreadable')
  else if (!turnstile.enabled) missing.push('TurnstileNotEnabled')
  if (!enabled) return { _tag: 'Off', missing } as const satisfies SubscriptionsStatus
  if (missing.length > 0 || turnstile._tag !== 'SetUp') {
    return { _tag: 'Paused', missing } as const satisfies SubscriptionsStatus
  }
  return { _tag: 'Open', siteKey: turnstile.siteKey } as const satisfies SubscriptionsStatus
}).pipe(Effect.withSpan('subscriptionsStatus'))
