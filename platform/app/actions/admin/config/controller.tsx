import { redirect } from 'remix/response/redirect'
import { createController } from 'remix/router'

import {
  getSavedSiteConfig,
  isSiteConfigured,
  parseSiteText,
  saveSiteConfig,
  type SiteConfig,
  type SiteImages,
  type SiteText,
} from '../../../data/config.ts'
import {
  deleteSiteImageFiles,
  processSiteImage,
  saveSiteImageFiles,
  SITE_IMAGE_KINDS,
  SiteImageError,
  type ProcessedSiteImage,
  type SiteImageKind,
} from '../../../data/site-images.ts'
import { routes } from '../../../routes.ts'
import { adminMiddleware, requireAdminLogin } from '../middleware.ts'
import { renderConfigPage, type ConfigIssue } from './config-page.tsx'

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
      let { logo, icon, socialImage } = getSavedSiteConfig()
      let images: SiteImages = { logo, icon, socialImage }
      let values = readConfigForm(formData)
      let issues: ConfigIssue[] = []
      let parsed = parseSiteText(values)
      if (!parsed.success) {
        issues = parsed.issues.map((issue) => {
          let [key] = issue.path ?? []
          let field = typeof key === 'object' ? key.key : key
          return { field: field as keyof SiteConfig | undefined, message: issue.message }
        })
      }

      // Uploads are turned into the files they're served as now, but only stored once the whole
      // form is valid.
      let uploads = new Map<SiteImageKind, ProcessedSiteImage>()
      let removals: SiteImageKind[] = []
      for (let kind of SITE_IMAGE_KINDS) {
        let upload = formData.get(kind)
        // A file input left empty sends an empty file.
        if (upload instanceof File && upload.size > 0) {
          try {
            uploads.set(kind, await processSiteImage(kind, upload))
          } catch (error) {
            if (!(error instanceof SiteImageError)) throw error
            issues.push({ field: kind, message: error.message })
          }
        } else if (formData.get(`${kind}Remove`) !== null) {
          removals.push(kind)
        }
      }
      let hasSocialImage =
        uploads.has('socialImage') || (images.socialImage && !removals.includes('socialImage'))
      if (hasSocialImage && !values.socialImageAlt) {
        issues.push({ field: 'socialImageAlt', message: 'Describe the social preview image' })
      }

      if (!parsed.success || issues.length > 0) {
        return context.render(
          ...renderConfigPage(context.request, {
            values,
            images,
            issues,
            unconfigured: !isSiteConfigured(),
          }),
        )
      }
      for (let [kind, upload] of uploads) {
        await saveSiteImageFiles(upload, images[kind])
        images[kind] = upload.image
      }
      for (let kind of removals) {
        let image = images[kind]
        if (image) await deleteSiteImageFiles(image)
        images[kind] = undefined
      }
      await saveSiteConfig({ ...parsed.text, ...images })
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
