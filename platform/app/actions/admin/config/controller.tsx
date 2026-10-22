import { redirect } from 'remix/response/redirect'
import { createController } from 'remix/router'

import {
  getSavedSiteConfig,
  isSiteConfigured,
  updateSiteConfig,
  type SiteText,
} from '../../../data/config.ts'
import { SITE_IMAGE_KINDS, type SiteImageKind } from '../../../data/site-images.ts'
import { routes } from '../../../routes.ts'
import { adminMiddleware, requireAdminLogin } from '../middleware.ts'
import { renderConfigPage } from './config-page.tsx'

export default createController(routes.admin.config, {
  middleware: [...adminMiddleware, requireAdminLogin()],
  actions: {
    index(context) {
      let { logo, icon, socialImage, ...saved } = getSavedSiteConfig()
      let values: SiteText = {
        ...saved,
        siteTitle: saved.siteTitle ?? '',
        // Most likely where the site is being set up. Behind the proxy (TRUST_PROXY), the request's
        // origin is the public one.
        siteUrl: saved.siteUrl ?? context.url.origin,
        siteDescription: saved.siteDescription ?? '',
      }
      return context.render(
        ...renderConfigPage(context.request, {
          values,
          images: { logo, icon, socialImage },
          saved: context.session.get('configSaved') === true,
          unconfigured: !isSiteConfigured(),
        }),
      )
    },
    async action(context) {
      let { formData } = context
      let values = readConfigForm(formData)
      let uploads: Partial<Record<SiteImageKind, File>> = {}
      let removals: SiteImageKind[] = []
      for (let kind of SITE_IMAGE_KINDS) {
        let upload = formData.get(kind)
        // A file input left empty sends an empty file.
        if (upload instanceof File && upload.size > 0) uploads[kind] = upload
        else if (formData.get(`${kind}Remove`) !== null) removals.push(kind)
      }
      let result = await updateSiteConfig(values, uploads, removals)
      if (!result.success) {
        let { logo, icon, socialImage } = getSavedSiteConfig()
        let page = { values, images: { logo, icon, socialImage }, issues: result.issues }
        return context.render(
          ...renderConfigPage(context.request, { ...page, unconfigured: !isSiteConfigured() }),
        )
      }
      context.session.flash('configSaved', true)
      return redirect(routes.admin.config.index.href(), 303)
    },
  },
})

// The submitted settings, trimmed, with line breaks (which browsers send as \r\n from a textarea)
// turned into spaces, since every setting is shown on one line. The site URL loses a trailing slash.
function readConfigForm(formData: FormData): SiteText {
  let text = (name: keyof SiteText) => {
    let value = formData.get(name)
    return typeof value === 'string' ? value.replace(/\s*[\r\n]+\s*/g, ' ').trim() : ''
  }
  return {
    siteTitle: text('siteTitle'),
    siteUrl: text('siteUrl').replace(/\/+$/, ''),
    siteDescription: text('siteDescription'),
    heroHeading: text('heroHeading'),
    heroSubheading: text('heroSubheading'),
    socialImageAlt: text('socialImageAlt'),
  }
}
