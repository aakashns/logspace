// The site's configuration: what's particular to this site, like its title, the home page's
// introduction, and its logos and icon. It's set at /admin/config and stored in the `config`
// table, one row per setting (images as JSON). The title, URL, and description are required:
// until they're saved the site isn't configured, and its public pages send visitors to
// /admin/login. Any other setting that's never been saved has its default.
import { Option, Result, Schema } from 'effect'

import { toIssues } from './issues.ts'

// The settings typed into the /admin/config form.
export interface SiteText {
  // Shown in the browser tab, link previews, the RSS feed, and as the author of the posts.
  readonly siteTitle: string
  // Where the site is served, like "https://example.com", with no path or trailing slash. For
  // canonical URLs, the sitemap, the RSS feed, link previews, and share links.
  readonly siteUrl: string
  // For search results and link previews of pages that have no description of their own.
  readonly siteDescription: string
  // The introduction at the top of the home page. Either can be empty.
  readonly heroHeading: string
  readonly heroSubheading: string
  // Describes the banner image, for people who can't see it. Needed when there's one.
  readonly bannerImageAlt: string
}

// The file pages link to for one of the site's images (in media storage, at /site/<file>), its
// size in pixels, and a hash of it for its URLs. The icon also has the color it's on where it
// can't be transparent, a hex color like "#1a2b3c".
export const SiteImage = Schema.Struct({
  file: Schema.String,
  // New uploads live in immutable generations; absent on pre-0.6 images.
  generation: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[0-9a-f-]{36}$/))),
  width: Schema.Int.check(Schema.isGreaterThan(0)),
  height: Schema.Int.check(Schema.isGreaterThan(0)),
  version: Schema.String,
  color: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^#[0-9a-f]{6}$/))),
})
export type SiteImage = typeof SiteImage.Type

// `logo` is for the light theme and `darkLogo` for the dark one.
export const SITE_IMAGE_KINDS = ['logo', 'darkLogo', 'icon', 'bannerImage'] as const
export type SiteImageKind = (typeof SITE_IMAGE_KINDS)[number]

// The images uploaded at /admin/config. Each theme shows its own logo, or the other theme's if it
// has none; without either the navbar shows the site's title. Without an icon the site has
// LogSpace's.
export type SiteImages = { readonly [K in SiteImageKind]?: SiteImage }

export type SiteConfig = SiteText & SiteImages

export const REQUIRED_SETTINGS = ['siteTitle', 'siteUrl', 'siteDescription'] as const
export type RequiredSetting = (typeof REQUIRED_SETTINGS)[number]

// The config as it's saved, which a site that isn't configured yet lacks some of.
export type SavedSiteConfig = Omit<SiteConfig, RequiredSetting> &
  Partial<Pick<SiteConfig, RequiredSetting>>

export const DEFAULT_SITE_CONFIG: SavedSiteConfig = {
  heroHeading: 'Hello, world!',
  heroSubheading: 'Welcome to my LogSpace.',
  bannerImageAlt: '',
}

export const TEXT_SETTINGS = [
  ...REQUIRED_SETTINGS,
  'heroHeading',
  'heroSubheading',
  'bannerImageAlt',
] as const satisfies readonly (keyof SiteText)[]

// Whether every required setting has been saved.
export function isSiteConfigured(config: SavedSiteConfig): config is SiteConfig {
  return REQUIRED_SETTINGS.every((key) => config[key])
}

// A problem with the /admin/config form.
export interface SiteConfigIssue {
  readonly field?: keyof SiteConfig
  readonly message: string
}

const required = (message: string) =>
  Schema.String.check(Schema.makeFilter((value: string) => value.trim() !== '', { message }))

// An http or https origin. The site's pages are at the root of it, so it can't have a path.
function isSiteUrl(value: string): boolean {
  let url = URL.parse(value)
  return (
    url !== null && (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value
  )
}

const decodeSiteText = Schema.decodeUnknownResult(
  Schema.Struct({
    siteTitle: required('The site needs a title'),
    siteUrl: Schema.String.check(
      Schema.makeFilter(isSiteUrl, {
        message:
          'Expected the address the site is served at, with no path, like "https://example.com"',
      }),
    ),
    siteDescription: required('The site needs a description'),
    heroHeading: Schema.String,
    heroSubheading: Schema.String,
    bannerImageAlt: Schema.String,
  }),
  { errors: 'all' },
)

// Checks the settings typed into the form.
export function parseSiteText(text: SiteText): Result.Result<SiteText, SiteConfigIssue[]> {
  return Result.mapError(decodeSiteText(text), (error) =>
    toIssues(error.issue).map(({ field, message }) =>
      isSiteConfigField(field) ? { field, message } : { message },
    ),
  )
}

// The settings of the /admin/config form, which its issues can be about.
export const SITE_CONFIG_FIELDS = [...TEXT_SETTINGS, ...SITE_IMAGE_KINDS] as const

function isSiteConfigField(field: string | undefined): field is keyof SiteConfig {
  return SITE_CONFIG_FIELDS.some((key) => key === field)
}

// The config as it's saved, from the `config` table's rows. A setting that's never been saved
// has its default, and an image whose row is mangled is left out, like a missing one.
export function fromConfigRows(rows: ReadonlyMap<string, string>): SavedSiteConfig {
  let config: { -readonly [K in keyof SavedSiteConfig]: SavedSiteConfig[K] } = {
    ...DEFAULT_SITE_CONFIG,
  }
  for (let key of TEXT_SETTINGS) {
    let value = rows.get(key)
    if (value !== undefined) config[key] = value
  }
  for (let kind of SITE_IMAGE_KINDS) {
    let image = Option.getOrUndefined(decodeSiteImage(rows.get(kind) ?? ''))
    if (image) config[kind] = image
  }
  return config
}

// A saved image setting, or none if it isn't valid JSON for one.
const decodeSiteImage = Schema.decodeUnknownOption(Schema.fromJsonString(SiteImage))
