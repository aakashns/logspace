import * as crypto from 'node:crypto'
import sharp, { type OutputInfo, type Sharp } from 'sharp'

import { FALLBACK_ICON_BACKGROUND } from '../lib/constants.ts'
import { routes } from '../routes.ts'
import type { SiteImage, SiteImages } from './config.ts'
import { mediaStorage } from './media.ts'

// The site's logo, icon, and social preview image, uploaded at /admin/config. Each upload is
// turned into the files the site serves when it's saved, kept in media storage under site/<file>,
// and described in the config (see config.ts) by the file pages link to, its size, and a hash of
// it for its URLs. Uploads can be PNG, JPEG, WebP, AVIF, GIF, or SVG, but SVGs are drawn as PNGs,
// since an SVG served from the site's own origin could run scripts.
//
// - logo: shown in the navbar in place of the site's title, as a mask filled with the text color
//   so it follows the theme. So it should be one color on a transparent background.
// - icon: the favicon, the home screen icons, and the web app manifest's icons, all made from one
//   square image. Without one, the icons are made from DEFAULT_ICON_SVG. The icons that can't be
//   transparent are on a color taken from the icon itself (see getBackgroundColor), which the
//   manifest uses too.
// - socialImage: the image link previews show for pages without one of their own.
export type SiteImageKind = 'logo' | 'icon' | 'socialImage'

export const SITE_IMAGE_KINDS: SiteImageKind[] = ['logo', 'icon', 'socialImage']

// The icon's files. The first two are at the root, where browsers and crawlers look for them
// whatever the page links; the rest are at /site/<file>.
export const ICON_FILES = [
  'favicon.ico',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
]

// The logo is drawn this many pixels high, several times its height in the navbar.
const LOGO_HEIGHT = 160
// The social preview image is at most this wide (link previews show it at up to 1200 × 630).
const SOCIAL_IMAGE_WIDTH = 1200

const SITE_FILES_PREFIX = 'site/'

const FORMATS = new Set(['png', 'jpeg', 'webp', 'avif', 'gif', 'svg'])

// LogSpace's mark, an L in a circle, for sites that haven't uploaded an icon.
export const DEFAULT_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' +
  '<circle cx="256" cy="256" r="256" fill="#161616"/>' +
  '<path fill="#dedede" d="M184 128h64v200h104v56H184z"/></svg>'

const DEFAULT_ICON_VERSION = hash(new TextEncoder().encode(DEFAULT_ICON_SVG))

// Why an upload can't be used, for the /admin/config form.
export class SiteImageError extends Error {}

// An upload turned into the files it's served as.
export interface ProcessedSiteImage {
  image: SiteImage
  files: File[]
}

// Makes an upload's files, or throws a SiteImageError if it isn't an image that can be used.
export async function processSiteImage(
  kind: SiteImageKind,
  upload: Blob,
): Promise<ProcessedSiteImage> {
  let bytes = new Uint8Array(await upload.arrayBuffer())
  switch (kind) {
    case 'logo': {
      let { image, format } = await openImage(bytes, LOGO_HEIGHT)
      let { data, info } = await image
        .resize({ height: LOGO_HEIGHT, withoutEnlargement: format !== 'svg' })
        .png()
        .toBuffer({ resolveWithObject: true })
      return single('logo.png', data, info)
    }
    case 'icon':
      return makeIcons((await openImage(bytes, 512)).image)
    case 'socialImage': {
      let { image, format } = await openImage(bytes, SOCIAL_IMAGE_WIDTH)
      // A PNG (or a GIF or SVG, likely a graphic too) stays one, so text in it stays sharp, and so
      // does anything with see-through pixels, which JPEG would turn black. Other photos become
      // JPEGs: not WebP or AVIF, which some sites can't show in link previews.
      let png = ['png', 'gif', 'svg'].includes(format) || !(await image.clone().stats()).isOpaque
      let resized = image.resize({ width: SOCIAL_IMAGE_WIDTH, withoutEnlargement: true })
      let { data, info } = await (png ? resized.png() : resized.jpeg({ quality: 85 })).toBuffer({
        resolveWithObject: true,
      })
      return single(png ? 'social.png' : 'social.jpg', data, info)
    }
  }
}

// Stores an image's files, and removes the files of the one it replaces that it doesn't have.
export async function saveSiteImageFiles(processed: ProcessedSiteImage, previous?: SiteImage) {
  for (let file of processed.files) await mediaStorage.set(SITE_FILES_PREFIX + file.name, file)
  let names = new Set(processed.files.map((file) => file.name))
  if (previous?.file && !names.has(previous.file)) await deleteSiteImageFiles(previous)
}

export async function deleteSiteImageFiles(image: SiteImage) {
  let names = image.file === 'icon-512.png' ? ICON_FILES : [image.file]
  for (let name of names) await mediaStorage.remove(SITE_FILES_PREFIX + name)
}

// One of the files the site serves for its images, with its current version, or null if there's
// no such file. Icons are the default ones until an icon is uploaded.
export async function getSiteFile(
  name: string,
  config: SiteImages,
): Promise<{ file: File; version: string } | null> {
  if (ICON_FILES.includes(name)) {
    if (!config.icon) {
      let file = (await getDefaultIcons()).files.find((file) => file.name === name)
      return file ? { file, version: DEFAULT_ICON_VERSION } : null
    }
    return stored(name, config.icon.version)
  }
  let image = [config.logo, config.socialImage].find((image) => image?.file === name)
  return image ? stored(name, image.version) : null
}

// The URL of one of the icon's files, with its version, so a new icon gets new URLs.
export function getIconHref(config: SiteImages, name: string) {
  let version = config.icon?.version ?? DEFAULT_ICON_VERSION
  let path =
    name === 'favicon.ico'
      ? routes.favicon.href()
      : name === 'apple-touch-icon.png'
        ? routes.appleTouchIcon.href()
        : routes.siteFile.href({ file: name })
  return `${path}?v=${version}`
}

// The color behind the icon where it can't be transparent, for the web app manifest.
export async function getIconColor(config: SiteImages) {
  let icon = config.icon ?? (await getDefaultIcons()).image
  return icon.color ?? FALLBACK_ICON_BACKGROUND
}

// The URL of the logo or social preview image.
export function getSiteImageHref(image: SiteImage) {
  return `${routes.siteFile.href({ file: image.file })}?v=${image.version}`
}

async function stored(name: string, version: string) {
  let file = await mediaStorage.get(SITE_FILES_PREFIX + name)
  return file ? { file, version } : null
}

let defaultIcons: Promise<ProcessedSiteImage> | undefined

function getDefaultIcons() {
  defaultIcons ??= openImage(new TextEncoder().encode(DEFAULT_ICON_SVG), 512).then(({ image }) =>
    makeIcons(image),
  )
  return defaultIcons
}

// The icon's files, from a square image (a wider or taller one is centered on a transparent
// square). The favicon and the manifest's plain icons keep any transparency; the home screen icons,
// which can't have it, are on the icon's background color. The maskable one has the icon in its
// middle 80%, the part every platform's mask keeps.
async function makeIcons(source: Sharp): Promise<ProcessedSiteImage> {
  let icon = await source
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  let color = await getBackgroundColor(icon)
  let resize = (size: number) => sharp(icon).resize(size, size)
  let favicon = await resize(32).png().toBuffer()
  let png = (name: string, data: Uint8Array) =>
    new File([new Uint8Array(data)], name, { type: 'image/png' })
  let files = [
    new File([toIco(favicon, 32)], 'favicon.ico', { type: 'image/x-icon' }),
    png('apple-touch-icon.png', await resize(180).flatten({ background: color }).png().toBuffer()),
    png('icon-192.png', await resize(192).png().toBuffer()),
    png('icon-512.png', icon),
    png(
      'icon-maskable-512.png',
      await sharp({ create: { width: 512, height: 512, channels: 4, background: color } })
        .composite([{ input: await resize(410).png().toBuffer() }])
        .png()
        .toBuffer(),
    ),
  ]
  let image = { file: 'icon-512.png', width: 512, height: 512, version: hash(icon), color }
  return { image, files }
}

// The most common color among an image's opaque pixels, as a hex color like "#1a2b3c", or
// FALLBACK_ICON_BACKGROUND if it has none. Pixels are counted in a 64 × 64 copy, scaled down without
// blending them into new colors, and grouped by color into 4096 bins (16 levels a channel), so a
// photo's many shades of one color count together; the color is the average of the biggest bin.
async function getBackgroundColor(image: Uint8Array) {
  let { data } = await sharp(image)
    .resize(64, 64, { fit: 'fill', kernel: 'nearest' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  let bins = new Map<number, { count: number; r: number; g: number; b: number }>()
  let biggest: { count: number; r: number; g: number; b: number } | undefined
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 255) continue
    let [r, g, b] = [data[i], data[i + 1], data[i + 2]]
    let key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    let bin = bins.get(key) ?? { count: 0, r: 0, g: 0, b: 0 }
    bins.set(key, bin)
    bin.count++
    bin.r += r
    bin.g += g
    bin.b += b
    if (!biggest || bin.count > biggest.count) biggest = bin
  }
  if (!biggest) return FALLBACK_ICON_BACKGROUND
  let { count } = biggest
  let hex = (sum: number) =>
    Math.round(sum / count)
      .toString(16)
      .padStart(2, '0')
  return `#${hex(biggest.r)}${hex(biggest.g)}${hex(biggest.b)}`
}

// The upload, upright, and its format, or a SiteImageError if it isn't an image. An SVG is drawn with at least `size` pixels on its shorter side.
async function openImage(bytes: Uint8Array, size: number) {
  let metadata
  try {
    metadata = await sharp(bytes).metadata()
  } catch {
    throw new SiteImageError('That file isn’t an image.')
  }
  if (!FORMATS.has(metadata.format)) {
    throw new SiteImageError('Upload a PNG, JPEG, WebP, AVIF, GIF, or SVG image.')
  }
  let { format } = metadata
  if (format !== 'svg') return { image: sharp(bytes).autoOrient(), format }
  let shorter = Math.min(metadata.width, metadata.height)
  let density = Math.min(2400, Math.max(72, Math.ceil((72 * size) / shorter)))
  return { image: sharp(bytes, { density }), format }
}

function single(name: string, data: Uint8Array, info: OutputInfo): ProcessedSiteImage {
  let type = name.endsWith('.png') ? 'image/png' : 'image/jpeg'
  return {
    image: { file: name, width: info.width, height: info.height, version: hash(data) },
    files: [new File([new Uint8Array(data)], name, { type })],
  }
}

// An ICO file holding one PNG, which every browser since IE 11 reads.
function toIco(png: Uint8Array, size: number) {
  let header = Buffer.alloc(22)
  header.writeUInt16LE(1, 2) // an icon
  header.writeUInt16LE(1, 4) // with one image
  header.writeUInt8(size, 6)
  header.writeUInt8(size, 7)
  header.writeUInt16LE(1, 10) // color planes
  header.writeUInt16LE(32, 12) // bits per pixel
  header.writeUInt32LE(png.byteLength, 14)
  header.writeUInt32LE(22, 18) // where the PNG starts
  return Buffer.concat([header, png])
}

function hash(bytes: Uint8Array) {
  return crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12)
}
