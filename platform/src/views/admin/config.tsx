import type { Child, Html } from '#jsx/jsx-runtime'

import type {
  SiteConfig,
  SiteConfigIssue,
  SiteImage,
  SiteImageKind,
  SiteImages,
  SiteText,
} from '../../domain/site.ts'
import { getIconHref, getSiteImageHref } from '../../domain/site-images.ts'
import { routes } from '../../routes.ts'
import { Field, TextareaField, TextField } from './fields.tsx'

export interface ConfigPageProps {
  // What was typed, and the images that are saved.
  readonly values: SiteText
  readonly images: SiteImages
  readonly issues?: readonly SiteConfigIssue[] | undefined
  // Set on the page shown after saving.
  readonly saved?: boolean | undefined
  // Set until the site's required settings are saved, when its public pages aren't shown.
  readonly unconfigured?: boolean | undefined
}

const LABELS: Record<keyof SiteConfig, string> = {
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

// /admin/config, with the submission's problems if it was rejected.
export function ConfigPage(props: ConfigPageProps): Html {
  let { values, images, issues = [], saved, unconfigured } = props
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
    <section class="admin-page">
      <h1 class="page-title">Configure Site</h1>
      {unconfigured && issues.length === 0 ? (
        <p role="status" class="notice">
          Set the site’s title, URL, and description to finish setting it up. Until they’re saved,
          visitors are sent to the admin login, and the RSS feed and sitemap aren’t available.
        </p>
      ) : null}
      {saved ? (
        <p role="status" class="notice">
          Saved.
        </p>
      ) : null}
      {issues.length > 0 ? (
        <div role="alert" class="alert">
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
        action={routes.admin.config()}
        enctype="multipart/form-data"
        class="form config-form"
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
          <button type="submit" class="button">
            Save
          </button>
          {/* /admin leads back here until the site is configured. */}
          {unconfigured ? null : (
            <a href={routes.admin.index()} class="secondary-button">
              Cancel
            </a>
          )}
        </div>
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
    <Field label={label} for={id} hint={hint}>
      {preview !== null ? (
        <div
          class={`image-preview${checkered ? ' checkered' : ''}${theme ? ` ${theme}-preview` : ''}`}
        >
          {preview}
        </div>
      ) : null}
      <input
        id={id}
        name={kind}
        type="file"
        accept={kind === 'bannerImage' ? BANNER_ACCEPT : ACCEPT}
        aria-invalid={invalid}
        class="file-input"
      />
      {removable ? (
        <label class="muted checkbox">
          <input type="checkbox" name={`${kind}Remove`} /> Remove
        </label>
      ) : null}
    </Field>
  )
}
