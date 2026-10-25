// The services the site connects to, at /admin/integrations: Cloudflare Turnstile and email. Each
// has a section of the page, with forms that post to its own URLs, so saving one never touches
// another.
import { Effect } from 'effect'
import { HttpRouter } from 'effect/http'

import { SiteConfigCommands } from '../../../data/site/commands.ts'
import { Email } from '../../../data/site/email.ts'
import { SiteConfigQueries } from '../../../data/site/queries.ts'
import type { EmailForm } from '../../../data/site/site.ts'
import { Turnstile } from '../../../data/site/turnstile.ts'
import { formText, SMALL_FORM_LIMIT, readForm } from '../../../lib/http/forms.ts'
import { redirect } from '../../../lib/http/responses.ts'
import { AdminAuth, type AdminSession } from '../../../lib/http/admin-session.ts'
import { urls } from '../../../lib/urls.ts'
import { adminOnly, adminPage } from '../admin.tsx'
import {
  type EmailSectionProps,
  type EmailTest,
  INTEGRATIONS_PAGE_STYLES,
  IntegrationsPage,
  type TurnstileSectionProps,
  type TurnstileVerification,
} from './page.tsx'

// Its forms are a few short keys, or the widget's token (at most 2 KB).
const FORM_LIMIT = SMALL_FORM_LIMIT

// The page, with what's to be shown in each section: what was just done in it, if anything.
const integrationsPage = (
  sections: {
    turnstile?: Omit<TurnstileSectionProps, 'status'>
    email?: Omit<EmailSectionProps, 'status'>
  },
  status: number = 200,
) =>
  Effect.gen(function* () {
    let turnstileStatus = yield* (yield* Turnstile).status
    let emailStatus = yield* (yield* Email).status
    return yield* adminPage(
      'Integrations',
      <IntegrationsPage
        turnstile={{ ...sections.turnstile, status: turnstileStatus }}
        email={{ ...sections.email, status: emailStatus }}
      />,
      {
        styles: INTEGRATIONS_PAGE_STYLES,
        status,
        // The widget is shown once there's a site key.
        turnstile: turnstileStatus._tag !== 'NotSetUp',
      },
    )
  })

// What was done is shown once, on the page it leads back to.
const FLASHES = {
  turnstileSaved: { turnstile: { notice: 'saved' } },
  turnstileRemoved: { turnstile: { notice: 'removed' } },
  emailSaved: { email: { notice: 'saved' } },
  emailRemoved: { email: { notice: 'removed' } },
} as const
type Flash = keyof typeof FLASHES
const isFlash = (flash: string | undefined): flash is Flash =>
  flash !== undefined && Object.hasOwn(FLASHES, flash)

const doneRedirect = (session: AdminSession, flash: Flash) =>
  Effect.map(AdminAuth, (auth) =>
    auth.saveSession(redirect(urls.admin.integrations(), 303), { ...session, flash }),
  )

const showIntegrations = adminOnly((session) =>
  Effect.gen(function* () {
    let auth = yield* AdminAuth
    let { flash, ...read } = session
    let response = yield* integrationsPage(isFlash(flash) ? FLASHES[flash] : {})
    return flash ? auth.saveSession(response, read) : response
  }),
)

const saveTurnstile = adminOnly((session) =>
  Effect.gen(function* () {
    let form = yield* readForm(FORM_LIMIT)
    let keys = { siteKey: formText(form, 'siteKey'), secretKey: formText(form, 'secretKey') }
    let enabled = form.has('enabled')
    return yield* (yield* SiteConfigCommands).saveTurnstile(keys, enabled).pipe(
      Effect.flatMap(() => doneRedirect(session, 'turnstileSaved')),
      // The secret key typed isn't shown again.
      Effect.catchTag('TurnstileKeysRejected', (rejected) =>
        integrationsPage(
          { turnstile: { rejected: { siteKey: keys.siteKey, enabled, issues: rejected.issues } } },
          400,
        ),
      ),
    )
  }),
)

const removeTurnstile = adminOnly((session) =>
  Effect.gen(function* () {
    yield* (yield* SiteConfigCommands).removeIntegration('turnstile')
    return yield* doneRedirect(session, 'turnstileRemoved')
  }),
)

// Checks the widget's answer with Cloudflare, and shows how that went. The widget puts its token
// in the form as cf-turnstile-response.
const verifyTurnstile = adminOnly(() =>
  Effect.gen(function* () {
    let form = yield* readForm(FORM_LIMIT)
    let verification: TurnstileVerification = yield* (yield* Turnstile)
      .verify(formText(form, 'cf-turnstile-response'))
      .pipe(
        Effect.map(({ hostname }) => ({ _tag: 'Verified', hostname }) as const),
        Effect.catch((failure) => Effect.succeed(failure)),
      )
    return yield* integrationsPage(
      { turnstile: { verification } },
      verificationStatus(verification),
    )
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

const saveEmail = adminOnly((session) =>
  Effect.gen(function* () {
    let form = yield* readForm(FORM_LIMIT)
    let typed: EmailForm = {
      provider: formText(form, 'provider'),
      fromName: formText(form, 'fromName'),
      from: formText(form, 'from'),
      replyTo: formText(form, 'replyTo'),
      hourlyLimit: formText(form, 'hourlyLimit'),
      sesRegion: formText(form, 'sesRegion'),
      sesEndpoint: formText(form, 'sesEndpoint'),
      sesAccessKeyId: formText(form, 'sesAccessKeyId'),
      sesSecretAccessKey: formText(form, 'sesSecretAccessKey'),
      resendApiKey: formText(form, 'resendApiKey'),
    }
    return yield* (yield* SiteConfigCommands).saveEmail(typed).pipe(
      Effect.flatMap(() => doneRedirect(session, 'emailSaved')),
      // The secret typed isn't shown again.
      Effect.catchTag('EmailSettingsRejected', (rejected) =>
        integrationsPage(
          {
            email: {
              rejected: {
                form: { ...typed, sesSecretAccessKey: '', resendApiKey: '' },
                issues: rejected.issues,
              },
            },
          },
          400,
        ),
      ),
    )
  }),
)

const removeEmail = adminOnly((session) =>
  Effect.gen(function* () {
    yield* (yield* SiteConfigCommands).removeIntegration('email')
    return yield* doneRedirect(session, 'emailRemoved')
  }),
)

// Sends a test email, with the saved settings, to the address typed, and shows how that went.
const testEmail = adminOnly(() =>
  Effect.gen(function* () {
    let to = formText(yield* readForm(FORM_LIMIT), 'to')
    let { siteTitle, siteUrl } = yield* (yield* SiteConfigQueries).saved
    let site = siteTitle || 'your LogSpace'
    let result: EmailTest = yield* (yield* Email)
      .send({
        to,
        subject: `Test email from ${site}`,
        text:
          `This is a test email from ${site}${siteUrl ? ` (${siteUrl})` : ''}, sent from ` +
          'its admin’s Integrations page. It arrived, so the site can send email.\n',
      })
      .pipe(
        Effect.as({ _tag: 'Sent', to } as const),
        Effect.catch((failure) => Effect.succeed(failure)),
      )
    return yield* integrationsPage({ email: { test: { result, to } } }, testStatus(result))
  }),
)

function testStatus(result: EmailTest): number {
  switch (result._tag) {
    case 'Sent':
      return 200
    case 'EmailNotSent':
      return 502
    case 'EmailNotSetUp':
    case 'SecretUnreadable':
      return 409
    case 'EmailAddressInvalid':
      return 400
    case 'EmailLimitReached':
      return 429
  }
}

export const IntegrationRoutes = HttpRouter.addAll([
  HttpRouter.route('GET', '/admin/integrations', showIntegrations),
  HttpRouter.route('POST', '/admin/integrations/turnstile', saveTurnstile),
  HttpRouter.route('POST', '/admin/integrations/turnstile/remove', removeTurnstile),
  HttpRouter.route('POST', '/admin/integrations/turnstile/verify', verifyTurnstile),
  HttpRouter.route('POST', '/admin/integrations/email', saveEmail),
  HttpRouter.route('POST', '/admin/integrations/email/remove', removeEmail),
  HttpRouter.route('POST', '/admin/integrations/email/test', testEmail),
])
