// /dev/design: the components in components/ui, for working on them.
import { HttpRouter } from 'effect/http'

import { urls } from '../../../lib/urls.ts'
import { devOnly, devPage } from '../dev.tsx'
import { DESIGN_PAGE_STYLES, DesignPage } from './page.tsx'

const design = devPage(urls.dev.design(), 'Design', DESIGN_PAGE_STYLES, <DesignPage />)

export const DesignRoutes = devOnly(
  HttpRouter.addAll([HttpRouter.route('GET', '/dev/design', design)]),
)
