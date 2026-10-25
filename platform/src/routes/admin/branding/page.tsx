import type { Child, Html } from '#jsx/jsx-runtime'

import { stylesheet } from '../../../components/stylesheet.ts'
import { Alert, ALERT_STYLES, AlertDescription, AlertTitle } from '../../../components/ui/alert.tsx'
import { Button } from '../../../components/ui/button.tsx'
import { Checkbox, CHECKBOX_STYLES } from '../../../components/ui/checkbox.tsx'
import { Field, FieldGroup, FieldLabel } from '../../../components/ui/field.tsx'
import { Input } from '../../../components/ui/input.tsx'
import { getIconHref, getSiteImageHref } from '../../../data/site/site-images.ts'
import type {
  SiteConfig,
  SiteConfigField,
  SiteConfigIssue,
  SiteImage,
  SiteImageKind,
  SiteImages,
  SiteText,
} from '../../../data/site/site.ts'
import { urls } from '../../../lib/urls.ts'
import { FIELDS_STYLES, hintId, LabelledField, TextareaField, TextField } from '../fields.tsx'
import { BackLink } from '../layout.tsx'
import css from './page.css' with { type: 'text' }

export const BRANDING_PAGE_STYLES = FIELDS_STYLES + CHECKBOX_STYLES + ALERT_STYLES + stylesheet(css)

export interface BrandingPageProps {
  // What was typed, and the images that are saved.
  readonly values: SiteText
  readonly images: SiteImages
  readonly issues?: readonly SiteConfigIssue[] | undefined
  // Set on the page shown after saving.
  readonly saved?: boolean | undefined
  // Set until the site's required settings are saved, when its public pages aren't shown.
  readonly unconfigured?: boolean | undefined
}

const LABELS: Record<SiteConfigField, string> = {
  siteTitle: 'Site title',
  siteUrl: 'Site URL',
  siteDescription: 'Site description',
  heroHeading: 'Home page heading',
  heroSubheading: 'Home page subheading',
  logo: 'Logo',
  darkLogo: 'Dark theme logo',
  icon: 'Icon',
  bannerImage: 'Banner image',
  bannerImageAlt: 'Banner image alt text',
}

const ACCEPT = 'image/png,image/jpeg,image/webp'
const BANNER_ACCEPT = 'image/png,image/jpeg'

// /admin/branding, with the submission's problems if it was rejected.
export function BrandingPage(props: BrandingPageProps): Html {
  let { values, images, issues = [], saved, unconfigured } = props
  let site: SiteConfig = { ...values, ...images }
  let invalid = (name: SiteConfigField) =>
    issues.some((issue) => issue.field === name) ? ('true' as const) : undefined
  let field = (name: keyof SiteText) => ({
    label: LABELS[name],
    name,
    id: `config-${name}`,
    value: values[name],
    invalid: invalid(name),
  })
  return (
    <section class="admin-page">
      {/* /admin leads back here until the site is configured. */}
      {unconfigured ? null : <BackLink />}
      <h1 class="page-title">Branding</h1>
      {unconfigured && issues.length === 0 ? (
        <Alert role="status">
          <AlertTitle>
            Set the site’s title, URL, and description to finish setting it up.
          </AlertTitle>
          <AlertDescription>
            Until they’re saved, visitors are sent to the admin login, and the RSS feed and sitemap
            aren’t available.
          </AlertDescription>
        </Alert>
      ) : null}
      {saved ? (
        <Alert role="status">
          <AlertTitle>Saved.</AlertTitle>
        </Alert>
      ) : null}
      {issues.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>
            The settings weren’t saved. Choose any images again before saving.
          </AlertTitle>
          <AlertDescription>
            <ul>
              {issues.map((issue) => (
                <li>
                  {issue.field ? `${LABELS[issue.field]}: ` : ''}
                  {issue.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      <form method="post" action={urls.admin.branding()} enctype="multipart/form-data">
        <FieldGroup>
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
            hint="Shown in the navbar instead of the site title, and in the dark theme too if there’s no dark theme logo. Use a transparent background; a PNG is best."
            preview={images.logo ? <LogoPreview image={images.logo} /> : null}
            checkered
            theme="light"
          />
          <ImageField
            kind="darkLogo"
            label={LABELS.darkLogo}
            invalid={invalid('darkLogo')}
            hint="The logo for the dark theme, like a lighter version of it. Without one, the dark theme shows the logo."
            preview={images.darkLogo ? <LogoPreview image={images.darkLogo} /> : null}
            checkered
            theme="dark"
          />
          <ImageField
            kind="icon"
            label={LABELS.icon}
            invalid={invalid('icon')}
            hint="The favicon and home screen icon. A square PNG, JPEG, or WebP, at least 512 × 512 pixels. Without one, the site has LogSpace’s."
            preview={<img src={getIconHref(site, 'icon-192.png')} alt="" width="64" height="64" />}
            checkered
            removable={images.icon !== undefined}
          />
          <ImageField
            kind="bannerImage"
            label={LABELS.bannerImage}
            invalid={invalid('bannerImage')}
            hint="Shown at the top of the home page, cropped to a 3:1 strip, and in link previews of pages without an image of their own, which crop its sides. A PNG or JPEG, ideally 1500 × 500 pixels, with what matters in the middle."
            preview={
              images.bannerImage ? (
                <img
                  src={getSiteImageHref(images.bannerImage)}
                  alt=""
                  width={images.bannerImage.width}
                  height={images.bannerImage.height}
                  class="banner-preview"
                />
              ) : null
            }
          />
          <TextField
            {...field('bannerImageAlt')}
            hint="Describes the banner image for people who can’t see it."
          />
          <div class="actions">
            <Button type="submit">Save</Button>
            {/* /admin leads back here until the site is configured. */}
            {unconfigured ? null : (
              <Button href={urls.admin.index()} variant="outline">
                Cancel
              </Button>
            )}
          </div>
        </FieldGroup>
      </form>
    </section>
  )
}

function LogoPreview(props: { image: SiteImage }): Html {
  let { image } = props
  return (
    <img
      src={getSiteImageHref(image)}
      alt=""
      width={image.width}
      height={image.height}
      class="logo-preview"
    />
  )
}

// One of the site's images: what it is now, a file input named after it to upload a new one, and
// a checkbox, `<kind>Remove`, to go back to having none (or, for the icon, the default one).
function ImageField(props: {
  kind: SiteImageKind
  label: string
  hint: string
  invalid?: 'true' | undefined
  preview: Child
  // Shows the preview on a checkerboard, so its transparent parts can be seen.
  checkered?: boolean | undefined
  // The theme a logo's preview is shown in, whichever one the page is in.
  theme?: 'light' | 'dark' | undefined
  // Defaults to whether there's a preview.
  removable?: boolean | undefined
}): Html {
  let {
    kind,
    label,
    hint,
    invalid,
    preview,
    checkered,
    theme,
    removable = preview !== null,
  } = props
  let id = `config-${kind}`
  return (
    <LabelledField label={label} for={id} hint={hint}>
      {preview !== null ? (
        <div
          class={`image-preview${checkered ? ' checkered' : ''}${theme ? ` ${theme}-preview` : ''}`}
        >
          {preview}
        </div>
      ) : null}
      <Input
        id={id}
        name={kind}
        type="file"
        accept={kind === 'bannerImage' ? BANNER_ACCEPT : ACCEPT}
        aria-invalid={invalid}
        aria-describedby={hintId(id)}
      />
      {removable ? (
        <Field orientation="horizontal">
          <Checkbox id={`${id}-remove`} name={`${kind}Remove`} />
          <FieldLabel for={`${id}-remove`}>Remove</FieldLabel>
        </Field>
      ) : null}
    </LabelledField>
  )
}
