// Everything done with sharp: reading and resizing posts' photos, and turning the site's logo,
// icon, and social preview image into the files the site serves. sharp does its work on libuv's
// thread pool, so a big photo's resize doesn't hold up other requests.
import { Context, Effect, Layer, Schema } from 'effect'
import sharp, { type OutputInfo, type Sharp } from 'sharp'

import { FALLBACK_ICON_BACKGROUND } from '../domain/constants.ts'
import type { ImageInfo } from '../domain/images.ts'
import type { SiteImage, SiteImageKind } from '../domain/site.ts'

// Why an upload can't be used as one of the site's images, for the /admin/config form.
export class SiteImageRejected extends Schema.TaggedError<SiteImageRejected>()(
  'SiteImageRejected',
  { message: Schema.String },
) {}

// sharp couldn't decode a photo.
export class ImageUnreadable extends Schema.TaggedError<ImageUnreadable>()('ImageUnreadable', {
  cause: Schema.Defect(),
}) {}

// A file the site serves for one of its images.
export interface SiteFile {
  readonly name: string
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly type: string
}

// An upload turned into the files it's served as.
export interface ProcessedSiteImage {
  readonly image: SiteImage
  readonly files: readonly SiteFile[]
}

// The icon's files. The first two are at the root, where browsers and crawlers look for them
// whatever the page links; the rest are at /site/<file>.
export const ICON_FILES = [
  'favicon.ico',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
]

// LogSpace's mark, for sites that haven't uploaded an icon: a pen nib on a dark gray circle, the
// same icon as logspace.app's. The nib is Phosphor Icons' pen-nib-fill (MIT License, Copyright (c)
// 2023 Phosphor Icons).
export const DEFAULT_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' +
  '<circle cx="256" cy="256" r="256" fill="#161616"/>' +
  '<path fill="#dedede" d="M397.9 209.6 302.4 114C293.7 105.3 279.6 105.3 270.9 114L231.4 153.6L150.7 183.9C143.2 186.6 137.8 193.2 136.5 201L107.6 374.4C107.2 376.7 108.4 379.1 110.5 380.2C112.7 381.3 115.3 380.9 117 379.2L196.3 299.9C193.8 294.7 192.7 288.9 193.1 283.1C194.2 268.5 204.6 256.3 218.9 253C233.2 249.7 247.9 256.1 255.3 268.8C262.6 281.4 260.9 297.4 251 308.2C241 318.9 225.2 322 212 315.7L132.7 395C131 396.7 130.6 399.3 131.7 401.4C132.8 403.6 135.2 404.8 137.6 404.4L310.9 375.5C318.8 374.2 325.3 368.8 328.1 361.4L358.4 280.6L397.9 241.1C406.6 232.4 406.6 218.3 397.9 209.6V209.6ZM348.8 258.7 253.3 163.2 286.7 129.8 382.2 225.3 348.8 258.7Z"/></svg>'

export const DEFAULT_ICON_VERSION = hash(new TextEncoder().encode(DEFAULT_ICON_SVG))

export class Images extends Context.Service<
  Images,
  {
    // A photo's upright size and a hash of it, or undefined if it isn't an image sharp can read
    // (a .jpg that isn't one): pages then show it without a size.
    readonly readInfo: (bytes: Uint8Array) => Effect.Effect<ImageInfo | undefined>
    // The photo at one of IMAGE_WIDTHS (or its own width, if that's smaller), upright, as WebP.
    // Fails if sharp can't decode it all (a truncated JPEG reads its size but not its pixels).
    readonly resize: (
      bytes: Uint8Array,
      width: number,
    ) => Effect.Effect<Uint8Array, ImageUnreadable>
    readonly processSiteImage: (
      kind: SiteImageKind,
      bytes: Uint8Array,
    ) => Effect.Effect<ProcessedSiteImage, SiteImageRejected>
    // The icons made from DEFAULT_ICON_SVG, made once.
    readonly defaultIcons: Effect.Effect<ProcessedSiteImage>
  }
>()('logspace/Images') {
  static readonly layer = Layer.effect(
    Images,
    Effect.gen(function* () {
      let defaultIcons = yield* Effect.cached(
        Effect.promise(async () =>
          makeIcons((await openImage(new TextEncoder().encode(DEFAULT_ICON_SVG), 512)).image),
        ),
      )
      return Images.of({
        readInfo: (bytes) =>
          Effect.promise(async () => {
            try {
              let { width, height } = (await sharp(bytes).metadata()).autoOrient
              return { width, height, version: hash(bytes) }
            } catch {
              return undefined
            }
          }),
        resize: (bytes, width) =>
          Effect.tryPromise({
            try: async () => {
              let resized = await sharp(bytes)
                .autoOrient()
                .resize({ width, withoutEnlargement: true })
                .webp({ quality: 78 })
                .toBuffer()
              return new Uint8Array(resized)
            },
            catch: (cause) => new ImageUnreadable({ cause }),
          }),
        processSiteImage: (kind, bytes) =>
          Effect.tryPromise({
            try: () => processSiteImage(kind, bytes),
            catch: (error) => error,
          }).pipe(
            Effect.catch((error) =>
              error instanceof SiteImageRejected ? Effect.fail(error) : Effect.die(error),
            ),
          ),
        defaultIcons,
      })
    }),
  )
}

// The logo is drawn this many pixels high, several times its height in the navbar.
const LOGO_HEIGHT = 160
// The social preview image is at most this wide (link previews show it at up to 1200 × 630).
const SOCIAL_IMAGE_WIDTH = 1200
const FORMATS = new Set(['png', 'jpeg', 'webp', 'avif', 'gif', 'svg'])

// Uploads can be PNG, JPEG, WebP, AVIF, GIF, or SVG, but SVGs are drawn as PNGs, since an SVG
// served from the site's own origin could run scripts.
async function processSiteImage(kind: SiteImageKind, bytes: Uint8Array) {
  switch (kind) {
    case 'logo': {
      // Shown in the navbar as a mask filled with the text color, so it follows the theme.
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

// The icon's files, from a square image (a wider or taller one is centered on a transparent
// square). The favicon and the manifest's plain icons keep any transparency; the home screen
// icons, which can't have it, are on the icon's background color. The maskable one has the icon
// in its middle 80%, the part every platform's mask keeps.
async function makeIcons(source: Sharp): Promise<ProcessedSiteImage> {
  let icon = new Uint8Array(
    await source
      .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer(),
  )
  let color = await getBackgroundColor(icon)
  let resize = (size: number) => sharp(icon).resize(size, size)
  let png = async (name: string, image: Sharp | Uint8Array<ArrayBuffer>): Promise<SiteFile> => ({
    name,
    bytes: image instanceof Uint8Array ? image : new Uint8Array(await image.png().toBuffer()),
    type: 'image/png',
  })
  let favicon = new Uint8Array(await resize(32).png().toBuffer())
  let files = [
    { name: 'favicon.ico', bytes: toIco(favicon, 32), type: 'image/x-icon' },
    await png('apple-touch-icon.png', resize(180).flatten({ background: color })),
    await png('icon-192.png', resize(192)),
    await png('icon-512.png', icon),
    await png(
      'icon-maskable-512.png',
      sharp({ create: { width: 512, height: 512, channels: 4, background: color } }).composite([
        { input: await resize(410).png().toBuffer() },
      ]),
    ),
  ]
  let image = { file: 'icon-512.png', width: 512, height: 512, version: hash(icon), color }
  return { image, files }
}

// The most common color among an image's opaque pixels, as a hex color like "#1a2b3c", or
// FALLBACK_ICON_BACKGROUND if it has none. Pixels are counted in a 64 × 64 copy, scaled down
// without blending them into new colors, and grouped by color into 4096 bins (16 levels a
// channel), so a photo's many shades of one color count together; the color is the average of
// the biggest bin.
async function getBackgroundColor(image: Uint8Array): Promise<string> {
  let { data } = await sharp(image)
    .resize(64, 64, { fit: 'fill', kernel: 'nearest' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  type Bin = { count: number; r: number; g: number; b: number }
  let bins = new Map<number, Bin>()
  let biggest: Bin | undefined
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

// The upload, upright, and its format. An SVG is drawn with at least `size` pixels on its shorter
// side.
async function openImage(bytes: Uint8Array, size: number) {
  let metadata
  try {
    metadata = await sharp(bytes).metadata()
  } catch {
    throw new SiteImageRejected({ message: 'That file isn’t an image.' })
  }
  if (!FORMATS.has(metadata.format)) {
    throw new SiteImageRejected({ message: 'Upload a PNG, JPEG, WebP, AVIF, GIF, or SVG image.' })
  }
  let { format } = metadata
  if (format !== 'svg') return { image: sharp(bytes).autoOrient(), format }
  let shorter = Math.min(metadata.width, metadata.height)
  let density = Math.min(2400, Math.max(72, Math.ceil((72 * size) / shorter)))
  return { image: sharp(bytes, { density }), format }
}

function single(name: string, data: Uint8Array, info: OutputInfo): ProcessedSiteImage {
  let bytes = new Uint8Array(data)
  return {
    image: { file: name, width: info.width, height: info.height, version: hash(bytes) },
    files: [{ name, bytes, type: name.endsWith('.png') ? 'image/png' : 'image/jpeg' }],
  }
}

// An ICO file holding one PNG, which every browser since IE 11 reads.
function toIco(png: Uint8Array, size: number): Uint8Array<ArrayBuffer> {
  let ico = new Uint8Array(22 + png.byteLength)
  let header = new DataView(ico.buffer)
  header.setUint16(2, 1, true) // an icon
  header.setUint16(4, 1, true) // with one image
  header.setUint8(6, size)
  header.setUint8(7, size)
  header.setUint16(10, 1, true) // color planes
  header.setUint16(12, 32, true) // bits per pixel
  header.setUint32(14, png.byteLength, true)
  header.setUint32(18, 22, true) // where the PNG starts
  ico.set(png, 22)
  return ico
}

// The first 12 hex digits of a SHA-256, which names a version of a file in its URLs.
export function hash(bytes: Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex').slice(0, 12)
}
