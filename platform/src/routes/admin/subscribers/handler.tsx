// /admin/subscribers: switching subscribing on and off. Who's subscribed will be listed here.
import { Effect } from 'effect'
import { HttpRouter } from 'effect/http'

import { SiteConfigCommands } from '../../../data/site/commands.ts'
import { subscriptionsStatus } from '../../../data/site/subscriptions.ts'
import { formText, readForm, SMALL_FORM_LIMIT } from '../../../lib/http/forms.ts'
import { redirect } from '../../../lib/http/responses.ts'
import { urls } from '../../../lib/urls.ts'
import { adminOnly, adminPage } from '../admin.tsx'
import { SUBSCRIBERS_PAGE_STYLES, SubscribersPage } from './page.tsx'

const subscribersPage = (status = 200) =>
  Effect.gen(function* () {
    let subscriptions = yield* subscriptionsStatus
    return yield* adminPage('Subscribers', <SubscribersPage status={subscriptions} />, {
      styles: SUBSCRIBERS_PAGE_STYLES,
      status,
    })
  })

const subscribers = adminOnly(() => subscribersPage())

// The switch is sent only while it's on. Switching it on while something it needs is missing
// shows the page again, saying what.
const saveSubscriptions = adminOnly(() =>
  Effect.gen(function* () {
    let enabled = formText(yield* readForm(SMALL_FORM_LIMIT), 'enabled') !== ''
    return yield* (yield* SiteConfigCommands).saveSubscriptions(enabled).pipe(
      Effect.as(redirect(urls.admin.subscribers(), 303)),
      Effect.catchTag('SubscriptionsNotReady', () => subscribersPage(409)),
    )
  }),
)

export const SubscriberRoutes = HttpRouter.addAll([
  HttpRouter.route('GET', '/admin/subscribers', subscribers),
  HttpRouter.route('POST', '/admin/subscribers', saveSubscriptions),
])
