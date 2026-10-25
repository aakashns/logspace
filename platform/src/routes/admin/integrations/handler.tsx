// The services the site connects to, at /admin/integrations. Each has a section of the page, with
// forms that post to its own URLs, so saving one never touches another.
import { Effect } from 'effect'
import { HttpRouter } from 'effect/http'

import { SiteConfigCommands } from '../../../data/site/commands.ts'
import { Turnstile } from '../../../data/site/turnstile.ts'
import { formText, LOGIN_FORM_LIMIT, readForm } from '../../../lib/http/forms.ts'
import { redirect } from '../../../lib/http/responses.ts'
import { AdminAuth, type Session } from '../../../lib/http/session.ts'
import { urls } from '../../../lib/urls.ts'
import { adminPage, loggedIn } from '../admin.tsx'
import {
  INTEGRATIONS_PAGE_STYLES,
  IntegrationsPage,
  type TurnstileSectionProps,
  type TurnstileVerification,
} from './page.tsx'

// Its forms are a few short keys, or the widget's token (at most 2 KB).
const FORM_LIMIT = LOGIN_FORM_LIMIT

const integrationsPage = (turnstile: Omit<TurnstileSectionProps, 'status'>, status: number = 200) =>
  Effect.gen(function* () {
    let turnstileStatus = yield* (yield* Turnstile).status
    return yield* adminPage(
      'Integrations',
      <IntegrationsPage turnstile={{ ...turnstile, status: turnstileStatus }} />,
      {
        styles: INTEGRATIONS_PAGE_STYLES,
        status,
        // The widget is shown once there's a site key.
        turnstile: turnstileStatus._tag !== 'NotSetUp',
      },
    )
  })

// What was done is shown once, on the page it leads back to.
const FLASHES = { turnstileSaved: 'saved', turnstileRemoved: 'removed' } as const
type Flash = keyof typeof FLASHES

const doneRedirect = (session: Session, flash: Flash) =>
  Effect.map(AdminAuth, (auth) =>
    auth.saveSession(redirect(urls.admin.integrations(), 303), { ...session, flash }),
  )

const showIntegrations = loggedIn((session) =>
  Effect.gen(function* () {
    let auth = yield* AdminAuth
    let { flash, ...read } = session
    let notice =
      flash === 'turnstileSaved' || flash === 'turnstileRemoved' ? FLASHES[flash] : undefined
    let response = yield* integrationsPage({ notice })
    return flash ? auth.saveSession(response, read) : response
  }),
)

const saveTurnstile = loggedIn((session) =>
  Effect.gen(function* () {
    let form = yield* readForm(FORM_LIMIT)
    let keys = { siteKey: formText(form, 'siteKey'), secretKey: formText(form, 'secretKey') }
    let enabled = form.has('enabled')
    return yield* (yield* SiteConfigCommands).saveTurnstile(keys, enabled).pipe(
      Effect.flatMap(() => doneRedirect(session, 'turnstileSaved')),
      // The secret key typed isn't shown again.
      Effect.catchTag('TurnstileKeysRejected', (rejected) =>
        integrationsPage(
          { rejected: { siteKey: keys.siteKey, enabled, issues: rejected.issues } },
          400,
        ),
      ),
    )
  }),
)

const removeTurnstile = loggedIn((session) =>
  Effect.gen(function* () {
    yield* (yield* SiteConfigCommands).removeIntegration('turnstile')
    return yield* doneRedirect(session, 'turnstileRemoved')
  }),
)

// Checks the widget's answer with Cloudflare, and shows how that went. The widget puts its token
// in the form as cf-turnstile-response.
const verifyTurnstile = loggedIn(() =>
  Effect.gen(function* () {
    let form = yield* readForm(FORM_LIMIT)
    let verification: TurnstileVerification = yield* (yield* Turnstile)
      .verify(formText(form, 'cf-turnstile-response'))
      .pipe(
        Effect.map(({ hostname }) => ({ _tag: 'Verified', hostname }) as const),
        Effect.catch((failure) => Effect.succeed(failure)),
      )
    return yield* integrationsPage({ verification }, verificationStatus(verification))
  }),
)

function verificationStatus(verification: TurnstileVerification): number {
  switch (verification._tag) {
    case 'Verified':
      return 200
    case 'TurnstileUnavailable':
      return 502
    case 'TurnstileNotSetUp':
    case 'SecretUnreadable':
      return 409
    case 'TurnstileTokenMissing':
    case 'TurnstileDenied':
      return 400
  }
}

export const IntegrationRoutes = HttpRouter.addAll([
  HttpRouter.route('GET', '/admin/integrations', showIntegrations),
  HttpRouter.route('POST', '/admin/integrations/turnstile', saveTurnstile),
  HttpRouter.route('POST', '/admin/integrations/turnstile/remove', removeTurnstile),
  HttpRouter.route('POST', '/admin/integrations/turnstile/verify', verifyTurnstile),
])
