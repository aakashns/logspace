// What every page under /dev shares. They're tools for working on the app, not pages of the site,
// so production (the binary) has none of them.
import { Effect, Layer } from 'effect'

import type { Child } from '#jsx/jsx-runtime'
import { Document } from '../../components/document.tsx'
import { AppConfig } from '../../lib/config.ts'
import { pageContext, pageResponse } from '../../lib/http/pages.ts'

// These routes, outside production.
export const devOnly = <E, R>(routes: Layer.Layer<never, E, R>) =>
  Layer.unwrap(Effect.map(AppConfig, ({ mode }) => (mode === 'production' ? Layer.empty : routes)))

// A page under /dev, out of search results, with its styles.
export const devPage = (path: string, title: string, styles: string, content: Child) =>
  Effect.gen(function* () {
    let page = yield* pageContext
    return pageResponse(
      page,
      <Document page={page} meta={{ path, title, noindex: true }} styles={styles}>
        {content}
      </Document>,
    )
  })
