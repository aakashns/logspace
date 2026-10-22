import * as s from 'remix/data-schema'
import type { Issue } from 'remix/data-schema'

import { db } from './db.ts'
import { config as configTable } from './tables.ts'

// The site's configuration: what's particular to this site, like its title, the home page's
// introduction, and its logo and icon. It's set at /admin/config and stored in the database's
// `config` table, one row per setting (images as JSON). The title, URL, and description are
// required: until they're saved the site isn't configured, and its public pages send visitors to
// /admin/login (see requireSiteConfig). Any other setting that's never been saved has its default.
export type SiteConfig = SiteText & SiteImages

// The config as it's saved, which a site that isn't configured yet lacks some of.
export type SavedSiteConfig = Omit<SiteConfig, RequiredSetting> &
  Partial<Pick<SiteConfig, RequiredSetting>>

export type RequiredSetting = 'siteTitle' | 'siteUrl' | 'siteDescription'

// The settings typed into the /admin/config form.
export interface SiteText {
  // Shown in the browser tab, link previews, the RSS feed, and as the author of the posts.
  siteTitle: string
  // Where the site is served, like "https://example.com", with no path or trailing slash. For
  // canonical URLs, the sitemap, the RSS feed, link previews, and share links.
  siteUrl: string
  // For search results and link previews of pages that have no description of their own.
  siteDescription: string
  // The introduction at the top of the home page. Either can be empty.
  heroHeading: string
  heroSubheading: string
  // Describes the social preview image, for people who can't see it. Needed when there's one.
  socialImageAlt: string
}

// The images uploaded at /admin/config, turned into the files the site serves (see
// site-images.ts). Without a logo the navbar shows the site's title, and without an icon the site
// has LogSpace's.
export interface SiteImages {
  logo?: SiteImage
  icon?: SiteImage
  socialImage?: SiteImage
}

// The file pages link to for one of the site's images (in media storage, at /site/<file>), its size
// in pixels, and a hash of it for its URLs. The icon also has the color it's on where it can't be
// transparent, a hex color like "#1a2b3c" (see site-images.ts).
export interface SiteImage {
  file: string
  width: number
  height: number
  version: string
  color?: string
}

export const REQUIRED_SETTINGS: RequiredSetting[] = ['siteTitle', 'siteUrl', 'siteDescription']

export const DEFAULT_SITE_CONFIG: SavedSiteConfig = {
  heroHeading: 'Hello, world!',
  heroSubheading: 'Welcome to my LogSpace.',
  socialImageAlt: '',
}

const TEXT_KEYS: (keyof SiteText)[] = [
  ...REQUIRED_SETTINGS,
  'heroHeading',
  'heroSubheading',
  'socialImageAlt',
]
const IMAGE_KEYS: (keyof SiteImages)[] = ['logo', 'icon', 'socialImage']

// The configuration is kept in memory, since every page needs it, and read again from the
// database in the background as requests come in, so changes made elsewhere (by another process,
// or in the database directly) take effect without a restart. The router's siteConfig middleware
// calls loadSiteConfig before each request is handled, so code that runs for a request can read
// it synchronously with getSiteConfig. Saving it updates the copy right away.
let current: SavedSiteConfig | undefined
// The first read, which requests wait for.
let loading: Promise<SavedSiteConfig> | undefined
// A read in the background, which requests don't wait for. There's at most one at a time.
let refreshing: Promise<void> | undefined
// Counts saves, so a background read that started before one doesn't replace what was saved.
let saves = 0

// Waits for the config the first time. After that it returns at once, and starts reading it again
// for later requests, so what a request sees is at most one read behind the database.
export async function loadSiteConfig(): Promise<void> {
  if (current) {
    refreshSiteConfig()
    return
  }
  loading ??= readSiteConfig().then(
    (value) => (current ??= value),
    (error) => {
      // Read it again next time.
      loading = undefined
      throw error
    },
  )
  await loading
}

// Reads the config again in the background. If that fails, the copy in memory is kept, and the
// next request tries again.
function refreshSiteConfig() {
  let save = saves
  refreshing ??= readSiteConfig()
    .then(
      (value) => {
        if (save === saves) current = value
      },
      (error) => console.error('Couldn’t read the site config again, keeping the last one:', error),
    )
    .finally(() => (refreshing = undefined))
}

// The config as it's saved, which code that can run before the site's configured (like the /admin
// pages and Document) reads.
export function getSavedSiteConfig(): SavedSiteConfig {
  if (!current) throw new Error('The site config isn’t loaded yet (see loadSiteConfig)')
  return current
}

// The config, for code that only runs once the site is configured: requireSiteConfig keeps public
// pages from running before then.
export function getSiteConfig(): SiteConfig {
  let config = getSavedSiteConfig()
  if (!isSiteConfigured(config)) throw new Error('The site isn’t configured yet')
  return config
}

// Whether every required setting has been saved.
export function isSiteConfigured(config = getSavedSiteConfig()): config is SiteConfig {
  return REQUIRED_SETTINGS.every((key) => config[key])
}

async function readSiteConfig(): Promise<SavedSiteConfig> {
  let config: SavedSiteConfig = { ...DEFAULT_SITE_CONFIG }
  for (let { key, value } of await db.findMany(configTable)) {
    if ((TEXT_KEYS as string[]).includes(key)) config[key as keyof SiteText] = value
    if ((IMAGE_KEYS as string[]).includes(key)) {
      let image = s.parseSafe(SiteImageSchema, parseJson(value))
      if (image.success) config[key as keyof SiteImages] = image.value
    }
  }
  return config
}

// Validates the settings typed into the /admin/config form.
export function parseSiteText(
  data: unknown,
): { success: true; text: SiteText } | { success: false; issues: readonly Issue[] } {
  let result = s.parseSafe(SiteTextSchema, data)
  if (!result.success) return { success: false, issues: result.issues }
  return { success: true, text: result.value }
}

// Saves every setting, replacing the saved ones. An image that's left out is removed.
export async function saveSiteConfig(value: SiteConfig) {
  await db.transaction(async (tx) => {
    for (let key of [...TEXT_KEYS, ...IMAGE_KEYS]) {
      await tx.delete(configTable, { key })
      let saved = value[key]
      if (saved === undefined) continue
      await tx.create(configTable, {
        key,
        value: typeof saved === 'string' ? saved : JSON.stringify(saved),
      })
    }
  })
  // As it's read back, without the images that are left out.
  let saved = Object.fromEntries(
    Object.entries(value).filter(([, setting]) => setting !== undefined),
  ) as SiteConfig
  saves++
  current = saved
}

let required = (message: string) => s.string().refine((value) => value.trim() !== '', message)

let SiteTextSchema = s.object({
  siteTitle: required('The site needs a title'),
  siteUrl: s
    .string()
    .refine(
      isSiteUrl,
      'Expected the address the site is served at, with no path, like "https://example.com"',
    ),
  siteDescription: required('The site needs a description'),
  heroHeading: s.string(),
  heroSubheading: s.string(),
  socialImageAlt: s.string(),
})

let pixels = s.number().refine((n) => Number.isInteger(n) && n > 0)
let SiteImageSchema = s.object({
  file: s.string(),
  width: pixels,
  height: pixels,
  version: s.string(),
  color: s.optional(s.string().refine((value) => /^#[0-9a-f]{6}$/.test(value))),
})

// A setting's JSON, or undefined if it isn't JSON, so a mangled row is ignored like an invalid one.
function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

// An http or https origin. The site's pages are at the root of it, so it can't have a path.
function isSiteUrl(value: string) {
  if (!URL.canParse(value)) return false
  let url = new URL(value)
  return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value
}
