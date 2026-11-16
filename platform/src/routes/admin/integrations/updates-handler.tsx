import { Effect } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/http'
import { formText, readForm, SMALL_FORM_LIMIT } from '../../../lib/http/forms.ts'
import { Updates } from '../../../lib/updates.ts'
import { adminOnly } from '../admin.tsx'
import { UpdateSection } from './updates.tsx'

// Polling GETs may retry across the service restart; mutation POSTs never replay.
const patch = (error?: string) =>
  Effect.gen(function* () {
    let status = yield* (yield* Updates).status
    let html = <UpdateSection status={status} error={error} />
    return HttpServerResponse.text(
      'event: datastar-patch-elements\ndata: selector #software-updates\ndata: mode inner\n' +
        html.value
          .replace(/^<section[^>]*>/, '')
          .replace(/<\/section>$/, '')
          .split(/\r\n?|\n/)
          .map((line) => `data: elements ${line}\n`)
          .join('') +
        '\n',
      { contentType: 'text/event-stream', headers: { 'Cache-Control': 'no-store' } },
    )
  })
const updateNow = adminOnly(() =>
  Effect.gen(function* () {
    return yield* (yield* Updates).request.pipe(
      Effect.andThen(patch()),
      Effect.catchTag('UpdatesUnavailable', (error) => patch(error.message)),
    )
  }),
)
const saveAutomatic = adminOnly(() =>
  Effect.gen(function* () {
    let enabled = formText(yield* readForm(SMALL_FORM_LIMIT), 'enabled') !== ''
    return yield* (yield* Updates).setEnabled(enabled).pipe(
      Effect.andThen(patch()),
      Effect.catchTag('UpdatesUnavailable', (error) => patch(error.message)),
    )
  }),
)
export const UpdateRoutes = HttpRouter.addAll([
  HttpRouter.route(
    'GET',
    '/admin/integrations/updates',
    adminOnly(() => patch()),
  ),
  HttpRouter.route('POST', '/admin/integrations/updates', updateNow),
  HttpRouter.route('POST', '/admin/integrations/updates/automatic', saveAutomatic),
])
