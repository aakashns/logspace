// /admin/subscribers, where the people who follow the site by email will be. There are none yet.
import { HttpRouter } from 'effect/http'

import { adminOnly, adminPage } from '../admin.tsx'
import { SubscribersPage } from './page.tsx'

const subscribers = adminOnly(() => adminPage('Subscribers', <SubscribersPage />))

export const SubscriberRoutes = HttpRouter.addAll([
  HttpRouter.route('GET', '/admin/subscribers', subscribers),
])
