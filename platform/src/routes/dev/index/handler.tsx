// /dev: a link to each tool for working on the app.
import { HttpRouter } from 'effect/http'

import { urls } from '../../../lib/urls.ts'
import { devOnly, devPage } from '../dev.tsx'
import { DEV_INDEX_STYLES, DevIndexPage } from './page.tsx'

const index = devPage(urls.dev.index(), 'Development', DEV_INDEX_STYLES, <DevIndexPage />)

export const DevIndexRoutes = devOnly(HttpRouter.addAll([HttpRouter.route('GET', '/dev', index)]))
