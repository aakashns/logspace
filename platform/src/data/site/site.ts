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
// ../../lib/secrets.ts) for TURNSTILE_SECRET_PURPOSE. Enabled, logging in requires passing it,
// with no way around it but `logspace turnstile off` (see ../../cli/turnstile.ts).
const TURNSTILE_KEY = /^[\w-]{10,200}$/
export const TurnstileSettings = Schema.Struct({
  siteKey: Schema.String.check(Schema.isPattern(TURNSTILE_KEY)),
  secretKey: SealedSecret,
  enabled: Schema.Boolean,
})
export type TurnstileSettings = typeof TurnstileSettings.Type
export const TURNSTILE_SECRET_PURPOSE = 'turnstile.secretKey'

// Email, which the site sends from `fromName` (if it's set) and `from`, with replies going to
// `replyTo` if it's set, through Amazon SES's or Resend's API. SES is sent to at `endpoint`, like
// https://email.us-east-1.amazonaws.com (or the site's fake of SES, at /dev/ses, in development),
// with an IAM user's access key. Resend is sent to with an API key. The secret access key and the
// API key are sealed (see ../../lib/secrets.ts) for EMAIL_SECRET_PURPOSES.
export const SesProvider = Schema.TaggedStruct('ses', {
  region: Schema.String,
  endpoint: Schema.String,
  accessKeyId: Schema.String,
  secretAccessKey: SealedSecret,
})
export const ResendProvider = Schema.TaggedStruct('resend', { apiKey: SealedSecret })
export const EmailSettings = Schema.Struct({
  fromName: Schema.String,
  from: Schema.String,
  replyTo: Schema.String,
  provider: Schema.Union([SesProvider, ResendProvider]),
})
export type EmailSettings = typeof EmailSettings.Type
export type EmailProvider = EmailSettings['provider']['_tag']
export const EMAIL_SECRET_PURPOSES = {
  ses: 'email.sesSecretAccessKey',
  resend: 'email.resendApiKey',
} as const satisfies Record<EmailProvider, string>

// The services the site connects to, set at /admin/integrations, each saved as one setting. One
// that's never been saved isn't set up.
export const INTEGRATIONS = ['turnstile', 'email'] as const
export type Integration = (typeof INTEGRATIONS)[number]
export interface SiteIntegrations {
  readonly turnstile?: TurnstileSettings
  readonly email?: EmailSettings
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
    issues.push({ field: 'secretKey', message: unreadableSecretMessage('secret key') })
  }
  return issues
}

// The email form, as typed (trimmed). Only the chosen provider's fields are used, and a secret
// access key or API key left empty keeps the saved one.
export interface EmailForm {
  readonly provider: string
  readonly fromName: string
  readonly from: string
  readonly replyTo: string
  readonly sesRegion: string
  readonly sesEndpoint: string
  readonly sesAccessKeyId: string
  readonly sesSecretAccessKey: string
  readonly resendApiKey: string
}

// A problem with the email form.
export interface EmailIssue {
  readonly field: keyof EmailForm
  readonly message: string
}

// The email settings a valid form saves, with the secret typed, which is empty to keep the saved
// one.
export type CheckedEmailForm = {
  readonly fromName: string
  readonly from: string
  readonly replyTo: string
  readonly provider:
    Omit<typeof SesProvider.Type, 'secretAccessKey'> | Omit<typeof ResendProvider.Type, 'apiKey'>
  readonly secret: string
}

// An address alone, like "news@example.com", without a name.
const EMAIL_ADDRESS = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+$/
export const isEmailAddress = (value: string) => value.length <= 254 && EMAIL_ADDRESS.test(value)
// Like us-east-1 or ap-southeast-2.
const AWS_REGION = /^[a-z]{2}(-[a-z]+)+-\d{1,2}$/
const AWS_ACCESS_KEY_ID = /^[A-Z0-9]{16,128}$/
const AWS_SECRET_ACCESS_KEY = /^[\w/+=]{20,128}$/
const RESEND_API_KEY = /^re_[\w-]{8,200}$/

// The address of an SES API, with no trailing slash: an http or https URL, with a path if it
// needs one, but no query, fragment, or credentials.
function sesEndpoint(value: string): string | undefined {
  let url = URL.parse(value)
  if (!url || !['http:', 'https:'].includes(url.protocol)) return undefined
  if (url.search || url.hash || url.username || url.password) return undefined
  return url.href.replace(/\/$/, '')
}

// Checks the email form. `saved` is whether the provider chosen has a saved secret, which one
// left empty keeps.
export function checkEmailForm(
  form: EmailForm,
  saved: SavedSecret,
): Result.Result<CheckedEmailForm, EmailIssue[]> {
  let issues: EmailIssue[] = []
  let address = 'Expected an email address, like news@example.com'
  // It goes in a header, so it's one line.
  if (form.fromName.length > 100 || /\p{Cc}/u.test(form.fromName)) {
    issues.push({
      field: 'fromName',
      message: 'Expected a name on one line, of up to 100 characters',
    })
  }
  if (!form.from) issues.push({ field: 'from', message: 'Enter the address to send from' })
  else if (!isEmailAddress(form.from)) issues.push({ field: 'from', message: address })
  if (form.replyTo && !isEmailAddress(form.replyTo)) {
    issues.push({ field: 'replyTo', message: address })
  }
  // The secret typed, checked, or the saved one if it opens.
  let secret = (field: 'sesSecretAccessKey' | 'resendApiKey', what: string, format: RegExp) => {
    if (form[field] && !format.test(form[field])) {
      issues.push({ field, message: `Expected the ${what}, as it was given to you` })
    } else if (!form[field] && saved !== 'readable') {
      issues.push({
        field,
        message: saved === 'unreadable' ? unreadableSecretMessage(what) : `Enter the ${what}`,
      })
    }
    return form[field]
  }
  if (form.provider === 'ses') {
    if (!AWS_REGION.test(form.sesRegion)) {
      issues.push({ field: 'sesRegion', message: 'Expected an AWS region, like us-east-1' })
    }
    let endpoint = sesEndpoint(form.sesEndpoint)
    if (endpoint === undefined) {
      issues.push({
        field: 'sesEndpoint',
        message: 'Expected the address of an SES API, like https://email.us-east-1.amazonaws.com',
      })
    }
    if (!AWS_ACCESS_KEY_ID.test(form.sesAccessKeyId)) {
      issues.push({
        field: 'sesAccessKeyId',
        message: 'Expected an access key ID, like AKIAIOSFODNN7EXAMPLE',
      })
    }
    let typed = secret('sesSecretAccessKey', 'secret access key', AWS_SECRET_ACCESS_KEY)
    if (issues.length > 0 || endpoint === undefined) return Result.fail(issues)
    return Result.succeed({
      fromName: form.fromName,
      from: form.from,
      replyTo: form.replyTo,
      provider: {
        _tag: 'ses',
        region: form.sesRegion,
        endpoint,
        accessKeyId: form.sesAccessKeyId,
      },
      secret: typed,
    })
  }
  if (form.provider === 'resend') {
    let typed = secret('resendApiKey', 'API key', RESEND_API_KEY)
    if (issues.length > 0) return Result.fail(issues)
    return Result.succeed({
      fromName: form.fromName,
      from: form.from,
      replyTo: form.replyTo,
      provider: { _tag: 'resend' },
      secret: typed,
    })
  }
  issues.push({ field: 'provider', message: 'Choose how to send email' })
  return Result.fail(issues)
}

// For a saved secret, like 'secret key', that doesn't open.
export const unreadableSecretMessage = (what: string) =>
  `The saved ${what} can’t be read, likely because AUTH_SESSION_SECRET changed since it was saved. Enter it again.`

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
  let email = Option.getOrUndefined(decodeEmail(rows.get('email') ?? ''))
  if (email) config.email = email
  return config
}

// A saved image setting, or none if it isn't valid JSON for one.
const decodeSiteImage = Schema.decodeUnknownOption(Schema.fromJsonString(SiteImage))
const decodeTurnstile = Schema.decodeUnknownOption(Schema.fromJsonString(TurnstileSettings))
const decodeEmail = Schema.decodeUnknownOption(Schema.fromJsonString(EmailSettings))
