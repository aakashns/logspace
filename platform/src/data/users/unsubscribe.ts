// Unsubscribing, by a link in each email to a subscriber, which works without signing in: the
// account's id, and its signature (see ../../lib/secrets.ts), so only the site can make one. With
// it go the headers that give email apps their own Unsubscribe button, which posts to the link
// (RFC 2369 and RFC 8058, which Gmail and Yahoo ask of senders of bulk email).
import { Effect, Schema } from 'effect'

import { Secrets } from '../../lib/secrets.ts'
import { urls } from '../../lib/urls.ts'

const PURPOSE = 'unsubscribe'

// The link isn't one the site made: it was cut short, or AUTH_SESSION_SECRET changed since.
export class UnsubscribeLinkInvalid extends Schema.TaggedError<UnsubscribeLinkInvalid>()(
  'UnsubscribeLinkInvalid',
  {},
) {}

// The link to unsubscribe account `id` from the site at `siteUrl`, and the headers for it.
export const unsubscribeLink = Effect.fn('unsubscribeLink')(function* (
  siteUrl: string,
  id: string,
) {
  let url = siteUrl + urls.unsubscribe(id, (yield* Secrets).sign(id, PURPOSE))
  return {
    url,
    headers: {
      'List-Unsubscribe': `<${url}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  }
})

export const checkUnsubscribeLink = Effect.fn('checkUnsubscribeLink')(function* (
  id: string,
  signature: string,
) {
  if (!(yield* Secrets).verify(id, signature, PURPOSE)) return yield* new UnsubscribeLinkInvalid()
})
