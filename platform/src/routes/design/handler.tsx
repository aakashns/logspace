// /design: the components in components/ui, for working on them. It's not a page of the site,
// so production (the binary) has no such route.
import { Effect, Layer } from 'effect'
import { HttpRouter } from 'effect/http'

import { Document } from '../../components/document.tsx'
import { AppConfig } from '../../lib/config.ts'
import { pageContext, pageResponse } from '../../lib/http/pages.ts'
import { urls } from '../../lib/urls.ts'
import { DESIGN_PAGE_STYLES, DesignPage } from './page.tsx'

const design = Effect.gen(function* () {
  let page = yield* pageContext
  return pageResponse(
    page,
    <Document
      page={page}
      meta={{ path: urls.design(), title: 'Design', noindex: true }}
      styles={DESIGN_PAGE_STYLES}
    >
      <DesignPage />
    </Document>,
  )
})

export const DesignRoutes = Layer.unwrap(
  Effect.map(AppConfig, ({ mode }) =>
    mode === 'production'
      ? Layer.empty
      : HttpRouter.addAll([HttpRouter.route('GET', '/design', design)]),
  ),
)
