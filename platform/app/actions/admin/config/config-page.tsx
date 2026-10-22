import type { Handle, RemixNode } from 'remix/component'
import { css } from 'remix/component'

import type { SiteConfig, SiteConfigIssue, SiteImages, SiteText } from '../../../data/config.ts'
import { getIconHref, getSiteImageHref, type SiteImageKind } from '../../../data/site-images.ts'
import { routes } from '../../../routes.ts'
import { SiteLogo } from '../../../ui/site-logo.tsx'
import { Field, TextareaField, TextField } from '../ui/fields.tsx'
import { renderAdminPage } from '../ui/page.tsx'
import {
  actionsStyle,
  alertStyle,
  buttonStyle,
  mutedStyle,
  noticeStyle,
  pageStyle,
  secondaryButtonStyle,
  titleStyle,
} from '../ui/styles.ts'

interface ConfigPageProps {
  // What was typed, and the images that are saved.
  values: SiteText
  images: SiteImages
  issues?: SiteConfigIssue[]
  // Set on the page shown after saving.
  saved?: boolean
  // Set until the site's required settings are saved, when its public pages aren't shown.
  unconfigured?: boolean
}

// The /admin/config page, with the submission's problems if it was rejected.
export function renderConfigPage(request: Request, props: ConfigPageProps) {
  let init = props.issues && { status: 400 }
  return renderAdminPage(request, 'Configure Site', <ConfigPage {...props} />, init)
}

const LABELS: Record<keyof SiteConfig, string> = {
  siteTitle: 'Site title',
  siteUrl: 'Site URL',
  siteDescription: 'Site description',
  heroHeading: 'Home page heading',
  heroSubheading: 'Home page subheading',
  logo: 'Logo',
  icon: 'Icon',
  socialImage: 'Social preview image',
  socialImageAlt: 'Social preview image alt text',
}

const ACCEPT = 'image/png,image/jpeg,image/webp,image/avif,image/gif,image/svg+xml'

function ConfigPage(handle: Handle<ConfigPageProps>) {
  return () => {
    let { values, images, issues = [], saved, unconfigured } = handle.props
    let site: SiteConfig = { ...values, ...images }
    let invalid = (name: keyof SiteConfig) =>
      issues.some((issue) => issue.field === name) ? ('true' as const) : undefined
    let field = (name: keyof SiteText) => ({
      label: LABELS[name],
      name,
      id: `config-${name}`,
      value: values[name],
      invalid: invalid(name),
    })
    return (
      <section mix={pageStyle}>
        <h1 mix={titleStyle}>Configure Site</h1>
        {unconfigured && issues.length === 0 ? (
          <p role="status" mix={noticeStyle}>
            Set the site’s title, URL, and description to finish setting it up. Until they’re saved,
            visitors are sent to the admin login, and the RSS feed and sitemap aren’t available.
          </p>
        ) : null}
        {saved ? (
          <p role="status" mix={noticeStyle}>
            Saved.
          </p>
        ) : null}
        {issues.length > 0 ? (
          <div role="alert" mix={alertStyle}>
            <p>The settings weren’t saved. Choose any images again before saving.</p>
            <ul>
              {issues.map((issue) => (
                <li>
                  {issue.field ? `${LABELS[issue.field]}: ` : ''}
                  {issue.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <form
          method="post"
          action={routes.admin.config.action.href()}
          enctype="multipart/form-data"
          mix={formStyle}
        >
          <TextField
            {...field('siteTitle')}
            hint="Shown in browser tabs, link previews, and the RSS feed, as the posts’ author, and in the navbar when there’s no logo."
          />
          <TextField
            {...field('siteUrl')}
            hint="Where the site is served, like https://example.com. Used for canonical URLs, the sitemap, the RSS feed, and share links."
          />
          <TextareaField
            {...field('siteDescription')}
            rows={2}
            hint="For search results and link previews of pages without a description of their own."
          />
          <TextField {...field('heroHeading')} hint="At the top of the home page. Can be empty." />
          <TextareaField
            {...field('heroSubheading')}
            rows={2}
            hint="Below the heading. Can be empty."
          />
          <ImageField
            kind="logo"
            label={LABELS.logo}
            invalid={invalid('logo')}
            hint="Shown in the navbar instead of the site title, in the text color, so use one color on a transparent background. SVG or PNG."
            preview={images.logo ? <SiteLogo site={site} height="2rem" /> : null}
            checkered
          />
          <ImageField
            kind="icon"
            label={LABELS.icon}
            invalid={invalid('icon')}
            hint="The favicon and home screen icon. A square image, at least 512 × 512 pixels, or an SVG. Without one, the site has LogSpace’s."
            preview={<img src={getIconHref(site, 'icon-192.png')} alt="" width="64" height="64" />}
            checkered
            removable={images.icon !== undefined}
          />
          <ImageField
            kind="socialImage"
            label={LABELS.socialImage}
            invalid={invalid('socialImage')}
            hint="Shown in link previews of pages without an image of their own, ideally 1200 × 630 pixels."
            preview={
              images.socialImage ? (
                <img
                  src={getSiteImageHref(images.socialImage)}
                  alt=""
                  width={String(images.socialImage.width)}
                  height={String(images.socialImage.height)}
                  mix={socialPreviewStyle}
                />
              ) : null
            }
          />
          <TextField
            {...field('socialImageAlt')}
            hint="Describes the social preview image for people who can’t see it."
          />
          <div mix={actionsStyle}>
            <button type="submit" mix={buttonStyle}>
              Save
            </button>
            {/* /admin leads back here until the site is configured. */}
            {unconfigured ? null : (
              <a href={routes.admin.index.href()} mix={secondaryButtonStyle}>
                Cancel
              </a>
            )}
          </div>
        </form>
      </section>
    )
  }
}

// One of the site's images: what it is now, a file input named after it to upload a new one, and
// a checkbox, `<kind>Remove`, to go back to having none (or, for the icon, the default one).
function ImageField(
  handle: Handle<{
    kind: SiteImageKind
    label: string
    hint: string
    invalid?: 'true'
    preview: RemixNode
    // Shows the preview on a checkerboard, so its transparent parts can be seen.
    checkered?: boolean
    // Defaults to whether there's a preview.
    removable?: boolean
  }>,
) {
  return () => {
    let {
      kind,
      label,
      hint,
      invalid,
      preview,
      checkered,
      removable = preview !== null,
    } = handle.props
    let id = `config-${kind}`
    return (
      <Field label={label} for={id} hint={hint}>
        {preview !== null ? (
          <div mix={[previewStyle, checkered ? checkerboardStyle : null]}>{preview}</div>
        ) : null}
        <input
          id={id}
          name={kind}
          type="file"
          accept={ACCEPT}
          aria-invalid={invalid}
          mix={fileInputStyle}
        />
        {removable ? (
          <label mix={[mutedStyle, checkboxStyle]}>
            <input type="checkbox" name={`${kind}Remove`} /> Remove
          </label>
        ) : null}
      </Field>
    )
  }
}

const formStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
})

const previewStyle = css({
  alignSelf: 'flex-start',
  maxWidth: '100%',
  padding: '0.75rem',
  border: '1px solid var(--border)',
  borderRadius: '0.5rem',
  '& img': { display: 'block' },
})

// Light and dark gray squares, the usual sign of transparency, a shade darker in the dark theme so
// the logo (drawn in the text color) stands out in either.
const checkerboardStyle = css({
  backgroundImage:
    'repeating-conic-gradient(light-dark(#d4d4d4, #3a3a3a) 0 25%, light-dark(#f4f4f4, #262626) 0 50%)',
  backgroundSize: '1rem 1rem',
})

const socialPreviewStyle = css({ maxWidth: '100%', height: 'auto', width: '24rem' })

const fileInputStyle = css({ maxWidth: '100%', fontSize: '0.875rem' })

const checkboxStyle = css({ display: 'flex', alignItems: 'center', gap: '0.375rem' })
