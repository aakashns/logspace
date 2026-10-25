// The site's configuration: what's particular to this site, like its title, the home page's
// introduction, and its logos and icon, set at /admin/branding, and the services it connects to,
// set at /admin/integrations. It's stored in the `config` table, one row per setting (images and
// integrations as JSON). The title, URL, and description are required: until they're saved the
// site isn't configured, and its public pages send visitors to /admin/login. Any other setting
// that's never been saved has its default.
import { Option, Result, Schema } from 'effect'

import { toIssues } from '../../lib/issues.ts'
import { SealedSecret } from '../../lib/secrets.ts'

// The settings typed into the /admin/branding form.
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

// The images uploaded at /admin/branding. Each theme shows its own logo, or the other theme's if it
// has none; without either the navbar shows the site's title. Without an icon the site has
// LogSpace's.
export type SiteImages = { readonly [K in SiteImageKind]?: SiteImage }

// Cloudflare Turnstile, which tells people from bots: the widget's site key, which pages show,
// and its secret key, which checks the widget's answers with Cloudflare, sealed (see
// ../../lib/secrets.ts) for TURNSTILE_SECRET_PURPOSE.
const TURNSTILE_KEY = /^[\w-]{10,200}$/
export const TurnstileSettings = Schema.Struct({
  siteKey: Schema.String.check(Schema.isPattern(TURNSTILE_KEY)),
  secretKey: SealedSecret,
})
export type TurnstileSettings = typeof TurnstileSettings.Type
export const TURNSTILE_SECRET_PURPOSE = 'turnstile.secretKey'

// The services the site connects to, set at /admin/integrations, each saved as one setting. One
// that's never been saved isn't set up.
export const INTEGRATIONS = ['turnstile'] as const
export type Integration = (typeof INTEGRATIONS)[number]
export interface SiteIntegrations {
  readonly turnstile?: TurnstileSettings
}

export type SiteConfig = SiteText & SiteImages & SiteIntegrations

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

// A problem with the /admin/branding form.
export interface SiteConfigIssue {
  readonly field?: SiteConfigField
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

// The settings of the /admin/branding form, which its issues can be about.
export const SITE_CONFIG_FIELDS = [...TEXT_SETTINGS, ...SITE_IMAGE_KINDS] as const

function isSiteConfigField(field: string | undefined): field is SiteConfigField {
  return SITE_CONFIG_FIELDS.some((key) => key === field)
}
export type SiteConfigField = (typeof SITE_CONFIG_FIELDS)[number]

// The Turnstile form's keys, trimmed. A secret key left empty keeps the saved one.
export interface TurnstileKeys {
  readonly siteKey: string
  readonly secretKey: string
}

// A problem with the Turnstile form.
export interface TurnstileIssue {
  readonly field: keyof TurnstileKeys
  readonly message: string
}

// Whether a secret key is saved, and if so whether it opens (see ../../lib/secrets.ts).
export type SavedSecret = 'none' | 'readable' | 'unreadable'

// Checks the Turnstile form's keys. Cloudflare doesn't say what keys look like, beyond the
// characters in them, so a mistyped key is only caught when it's used.
export function checkTurnstileKeys(keys: TurnstileKeys, saved: SavedSecret): TurnstileIssue[] {
  let issues: TurnstileIssue[] = []
  let format = 'Expected a key from Cloudflare: letters, digits, dashes, and underscores'
  if (!keys.siteKey) issues.push({ field: 'siteKey', message: 'Enter the widget’s site key' })
  else if (!TURNSTILE_KEY.test(keys.siteKey)) issues.push({ field: 'siteKey', message: format })
  if (keys.secretKey) {
    if (!TURNSTILE_KEY.test(keys.secretKey)) issues.push({ field: 'secretKey', message: format })
    else if (keys.secretKey === keys.siteKey) {
      issues.push({ field: 'secretKey', message: 'That’s the site key; copy the secret key' })
    }
  } else if (saved === 'none') {
    issues.push({ field: 'secretKey', message: 'Enter the widget’s secret key' })
  } else if (saved === 'unreadable') {
    issues.push({ field: 'secretKey', message: UNREADABLE_SECRET_MESSAGE })
  }
  return issues
}

export const UNREADABLE_SECRET_MESSAGE =
  'The saved secret key can’t be read, likely because AUTH_SESSION_SECRET changed since it was saved. Enter it again.'

// The config as it's saved, from the `config` table's rows. A setting that's never been saved
// has its default, and an image or integration whose row is mangled is left out, like a missing
// one.
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
  let turnstile = Option.getOrUndefined(decodeTurnstile(rows.get('turnstile') ?? ''))
  if (turnstile) config.turnstile = turnstile
  return config
}

// A saved image setting, or none if it isn't valid JSON for one.
const decodeSiteImage = Schema.decodeUnknownOption(Schema.fromJsonString(SiteImage))
const decodeTurnstile = Schema.decodeUnknownOption(Schema.fromJsonString(TurnstileSettings))
