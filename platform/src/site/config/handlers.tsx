// The site's settings, at /admin/config.
import { Effect } from 'effect'
import { HttpRouter } from 'effect/http'

import { adminPage, loggedIn } from '../../admin/pages.tsx'
import { AdminAuth } from '../../admin/session.ts'
import { readForm } from '../../http/forms.ts'
import { requestUrl } from '../../http/pages.ts'
import { redirect } from '../../http/responses.ts'
import { routes } from '../../routes.ts'
import { SiteConfigCommands } from '../commands.ts'
import { SiteConfigQueries } from '../queries.ts'
import {
  isSiteConfigured,
  SITE_IMAGE_KINDS,
  type SiteConfigIssue,
  type SiteImageKind,
  type SiteText,
} from '../site.ts'
import { ConfigPage } from './components/config.tsx'

const configPage = (props: {
  values: SiteText
  issues?: readonly SiteConfigIssue[] | undefined
  saved?: boolean | undefined
}) =>
  Effect.gen(function* () {
    let saved = yield* (yield* SiteConfigQueries).saved
    return yield* adminPage(
      'Configure Site',
      <ConfigPage {...props} images={saved} unconfigured={!isSiteConfigured(saved)} />,
      { status: props.issues ? 400 : 200 },
    )
  })

const showConfig = loggedIn((session) =>
  Effect.gen(function* () {
    let auth = yield* AdminAuth
    let saved = yield* (yield* SiteConfigQueries).saved
    let values: SiteText = {
      siteTitle: saved.siteTitle ?? '',
      // Most likely where the site is being set up. Behind the proxy (TRUST_PROXY), the
      // request's origin is the public one.
      siteUrl: saved.siteUrl ?? (yield* requestUrl).origin,
      siteDescription: saved.siteDescription ?? '',
      heroHeading: saved.heroHeading,
      heroSubheading: saved.heroSubheading,
      bannerImageAlt: saved.bannerImageAlt,
    }
    let response = yield* configPage({ values, saved: session.flash === 'configSaved' })
    // The note that the settings were saved is shown once.
    let { flash, ...read } = session
    return flash ? auth.saveSession(response, read) : response
  }),
)

const saveConfig = loggedIn((session) =>
  Effect.gen(function* () {
    let form = yield* readForm()
    let values = readConfigForm(form)
    let uploads: Partial<Record<SiteImageKind, File>> = {}
    let removals: SiteImageKind[] = []
    for (let kind of SITE_IMAGE_KINDS) {
      let upload = form.get(kind)
      // A file input left empty sends an empty file.
      if (typeof upload !== 'string' && upload !== null && upload.size > 0) uploads[kind] = upload
      else if (form.get(`${kind}Remove`) !== null) removals.push(kind)
    }
    return yield* (yield* SiteConfigCommands).update(values, uploads, removals).pipe(
      Effect.flatMap(() =>
        Effect.map(AdminAuth, (auth) =>
          auth.saveSession(redirect(routes.admin.config(), 303), {
            ...session,
            flash: 'configSaved',
          }),
        ),
      ),
      Effect.catchTag('SiteConfigRejected', (rejected) =>
        configPage({ values, issues: rejected.issues }),
      ),
    )
  }),
)

// The submitted settings, trimmed, with line breaks (which browsers send as \r\n from a
// textarea) turned into spaces, since every setting is shown on one line. The site URL loses a
// trailing slash.
function readConfigForm(form: FormData): SiteText {
  let text = (name: keyof SiteText) => {
    let value = form.get(name)
    return typeof value === 'string' ? value.replace(/\s*[\r\n]+\s*/g, ' ').trim() : ''
  }
  return {
    siteTitle: text('siteTitle'),
    siteUrl: text('siteUrl').replace(/\/+$/, ''),
    siteDescription: text('siteDescription'),
    heroHeading: text('heroHeading'),
    heroSubheading: text('heroSubheading'),
    bannerImageAlt: text('bannerImageAlt'),
  }
}

export const ConfigRoutes = HttpRouter.addAll([
  HttpRouter.route('GET', '/admin/config', showConfig),
  HttpRouter.route('POST', '/admin/config', saveConfig),
])
