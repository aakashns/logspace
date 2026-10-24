// Everything done with Bun.Image: reading and resizing posts' photos, and turning the site's logos,
// icon, and banner image into the files the site serves. Bun.Image does its work on a
// worker thread, so a big photo's resize doesn't hold up other requests.
import { readFileSync } from 'node:fs'
import { Context, Effect, Layer, Predicate, Schema } from 'effect'

import type { ImageInfo } from '../domain/images.ts'
import type { SiteImage, SiteImageKind } from '../domain/site.ts'
import defaultIconPath from './default-icon.png' with { type: 'file' }

// The same codecs everywhere: otherwise macOS would also read HEIC and AVIF, which Linux can't.
Bun.Image.backend = 'bun'

// Why an upload can't be used as one of the site's images, for the /admin/config form.
export class SiteImageRejected extends Schema.TaggedError<SiteImageRejected>()(
  'SiteImageRejected',
  { message: Schema.String },
) {}

// A photo couldn't be decoded.
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
export const ICON_FILES = ['favicon.ico', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png']

// LogSpace's mark, for sites that haven't uploaded an icon: a pen nib on a dark gray circle, the
// same icon as logspace.app's, drawn at 512 × 512. The nib is Phosphor Icons' pen-nib-fill (MIT
// License, Copyright (c) 2023 Phosphor Icons).
const DEFAULT_ICON = new Uint8Array(readFileSync(defaultIconPath))

export class Images extends Context.Service<
  Images,
  {
    // A photo's upright size and a hash of it, or undefined if it isn't an image Bun can read
    // (a .jpg that isn't one): pages then show it without a size.
    readonly readInfo: (bytes: Uint8Array) => Effect.Effect<ImageInfo | undefined>
    // The photo at one of IMAGE_WIDTHS (or its own width, if that's smaller), upright, as WebP.
    // Fails if Bun can't decode it all (a PNG cut short reads its size but not its pixels).
    readonly resize: (
      bytes: Uint8Array,
      width: number,
    ) => Effect.Effect<Uint8Array, ImageUnreadable>
    readonly processSiteImage: (
      kind: SiteImageKind,
      bytes: Uint8Array,
    ) => Effect.Effect<ProcessedSiteImage, SiteImageRejected>
    // The icons made from DEFAULT_ICON, made once.
    readonly defaultIcons: Effect.Effect<ProcessedSiteImage>
  }
>()('logspace/Images') {
  static readonly layer = Layer.effect(
    Images,
    Effect.gen(function* () {
      let defaultIcons = yield* Effect.cached(
        Effect.promise(() => makeIcons(DEFAULT_ICON, DEFAULT_ICON_COLOR)),
      )
      return Images.of({
        readInfo: (bytes) =>
          Effect.tryPromise(() => new Bun.Image(bytes).metadata()).pipe(
            Effect.map(({ width, height }) => ({ width, height, version: hash(bytes) })),
            Effect.orElseSucceed(() => undefined),
          ),
        resize: (bytes, width) =>
          Effect.tryPromise({
            try: () =>
              new Bun.Image(bytes)
                .resize(width, undefined, { withoutEnlargement: true })
                .webp({ quality: 78 })
                .bytes(),
            catch: (cause) => new ImageUnreadable({ cause }),
          }),
        processSiteImage,
        defaultIcons,
      })
    }),
  )
}

// The logos are made this many pixels high: over three times their height in the navbar (1.2rem),
// for the sharpest screens, and twice that of their previews at /admin/config (2rem). Any bigger
// and the navbar's logo is a download that holds up the page's first full paint.
const LOGO_HEIGHT = 64
// The icon is at least this many pixels square.
const ICON_SIZE = 512
// The banner image is at most this wide, the width link previews are made for. The home page
// shows WebP copies of it resized to fit the screen (see queries/site-files.ts), so this one is
// mostly what link previews fetch.
const BANNER_WIDTH = 1200
// What each site image can be uploaded as. Bun.Image reads GIFs too, but not SVGs, which couldn't
// be served from the site's own origin anyway: they can run scripts.
const FORMATS: Record<SiteImageKind, readonly string[]> = {
  logo: ['png', 'jpeg', 'webp'],
  darkLogo: ['png', 'jpeg', 'webp'],
  icon: ['png', 'jpeg', 'webp'],
  bannerImage: ['png', 'jpeg'],
}
// The color behind LogSpace's icon, for the web app manifest.
const DEFAULT_ICON_COLOR = '#161616'

// Uploads are checked, not fixed: an icon that isn't square or big enough is refused, not cropped
// or padded, and the images are only resized and re-encoded.
const processSiteImage = Effect.fnUntraced(function* (kind: SiteImageKind, bytes: Uint8Array) {
  let { format, width, height } = yield* inspect(kind, bytes)
  switch (kind) {
    case 'logo':
    case 'darkLogo': {
      // Lossless WebP, a little over half the size of Bun's PNG, keeps a logo's edges sharp.
      let image = new Bun.Image(bytes)
      if (height > LOGO_HEIGHT) {
        image.resize(Math.round((width * LOGO_HEIGHT) / height), LOGO_HEIGHT)
      }
      let name = kind === 'logo' ? 'logo.webp' : 'dark-logo.webp'
      return yield* single(name, yield* decode(() => image.webp({ lossless: true }).bytes()))
    }
    case 'icon':
      if (width !== height || width < ICON_SIZE) {
        return yield* new SiteImageRejected({
          message: `The icon must be square, at least ${ICON_SIZE} × ${ICON_SIZE} pixels.`,
        })
      }
      return yield* decode(() => makeIcons(bytes))
    case 'bannerImage': {
      // A PNG stays one, so text in it stays sharp, and a JPEG stays a JPEG: some sites' link
      // previews don't show WebP. A progressive JPEG shows a blurry whole while it loads.
      let image = new Bun.Image(bytes).resize(BANNER_WIDTH, undefined, {
        withoutEnlargement: true,
      })
      return format === 'png'
        ? yield* single('banner.png', yield* decode(() => image.png().bytes()))
        : yield* single(
            'banner.jpg',
            yield* decode(() => image.jpeg({ quality: 80, progressive: true }).bytes()),
          )
    }
  }
})

// Bun.Image's work on an upload whose header was fine. If the rest of it isn't (a file cut
// short), the upload is refused; any other failure is a defect.
const decode = <A>(work: () => Promise<A>) =>
  Effect.tryPromise({ try: work, catch: (cause) => new ImageUnreadable({ cause }) }).pipe(
    Effect.catchTag('ImageUnreadable', ({ cause }) =>
      isImageError(cause)
        ? Effect.fail(new SiteImageRejected({ message: 'That image couldn’t be read.' }))
        : Effect.die(cause),
    ),
  )

// The icon's files, from a square image at least ICON_SIZE across.
async function makeIcons(source: Uint8Array, color?: string): Promise<ProcessedSiteImage> {
  let resize = (size: number) => new Bun.Image(source).resize(size, size).png().bytes()
  let png = async (name: string, size: number): Promise<SiteFile> => ({
    name,
    bytes: new Uint8Array(await resize(size)),
    type: 'image/png',
  })
  let icon = await png('icon-512.png', ICON_SIZE)
  let files = [
    { name: 'favicon.ico', bytes: toIco(await resize(32), 32), type: 'image/x-icon' },
    await png('apple-touch-icon.png', 180),
    await png('icon-192.png', 192),
    icon,
  ]
  let image = {
    file: 'icon-512.png',
    width: ICON_SIZE,
    height: ICON_SIZE,
    version: hash(icon.bytes),
    ...(color && { color }),
  }
  return { image, files }
}

// The upload's upright size and format, if it's one the site image can be.
const inspect = Effect.fnUntraced(function* (kind: SiteImageKind, bytes: Uint8Array) {
  let metadata = yield* Effect.tryPromise({
    try: () => new Bun.Image(bytes).metadata(),
    catch: () => new SiteImageRejected({ message: 'That file isn’t an image.' }),
  })
  let formats = FORMATS[kind]
  if (!formats.includes(metadata.format)) {
    return yield* new SiteImageRejected({
      message: `Upload a ${formats.map((format) => format.toUpperCase()).join(' or ')} image.`,
    })
  }
  return metadata
})

function isImageError(error: unknown): boolean {
  return (
    Predicate.hasProperty(error, 'code') &&
    typeof error.code === 'string' &&
    error.code.startsWith('ERR_IMAGE_')
  )
}

// One file, made by this app, so reading it back can't fail.
const single = (name: string, bytes: Uint8Array) =>
  Effect.promise(() => new Bun.Image(bytes).metadata()).pipe(
    Effect.map(({ width, height }): ProcessedSiteImage => ({
      image: { file: name, width, height, version: hash(bytes) },
      files: [
        {
          name,
          bytes: new Uint8Array(bytes),
          type: name.endsWith('.png')
            ? 'image/png'
            : name.endsWith('.webp')
              ? 'image/webp'
              : 'image/jpeg',
        },
      ],
    })),
  )

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
