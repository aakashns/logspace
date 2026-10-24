// The site's image files: uploaded icons, logos, and banner, or the default icons from Images.
// These queries have no state of their own; Images owns the cached default icons.
import { Effect } from 'effect'

import { IMAGE_WIDTHS } from '../lib/image-widths.ts'
import { ICON_FILES, Images } from '../lib/images.ts'
import { MediaStorage, mediaKeys } from '../lib/media-storage.ts'
import { DEFAULT_ICON_VERSION } from './site-images.ts'
import type { SiteImages } from './site.ts'

// Behind the home screen icons, and the web app manifest's colors, when the icon has no opaque
// pixels to take a color from.
const FALLBACK_ICON_BACKGROUND = '#ffffff'

const stored = Effect.fnUntraced(function* (name: string, version: string, generation?: string) {
  let storage = yield* MediaStorage
  let file = yield* storage.get(mediaKeys.siteFile(name, generation))
  return file && { file, version }
})

// One of the site's image files with its current version, or undefined if it doesn't exist.
export const getSiteFile = Effect.fn('getSiteFile')(function* (name: string, images: SiteImages) {
  if (ICON_FILES.includes(name)) {
    if (images.icon) return yield* stored(name, images.icon.version, images.icon.generation)
    let { defaultIcons } = yield* Images
    let icon = (yield* defaultIcons).files.find((file) => file.name === name)
    if (!icon) return undefined
    let blob = new Blob([icon.bytes], { type: icon.type })
    let file = { blob, size: blob.size, type: icon.type, lastModified: STARTED_AT }
    return { file, version: DEFAULT_ICON_VERSION }
  }
  let image = [images.logo, images.darkLogo, images.bannerImage].find(
    (image) => image?.file === name,
  )
  return image ? yield* stored(name, image.version, image.generation) : undefined
})

// Unlike PostMedia, concurrent requests may both make a missing copy: there's only one banner.
export const resizedSiteFile = Effect.fn('resizedSiteFile')(function* (
  name: string,
  width: number,
  version: string,
  { bannerImage }: SiteImages,
) {
  if (bannerImage?.file !== name || bannerImage.version !== version) return undefined
  if (!IMAGE_WIDTHS.includes(width)) return undefined
  let storage = yield* MediaStorage
  let images = yield* Images
  let key = `${mediaKeys.siteVariants(name)}${width}-${version}.webp`
  let existing = yield* storage.get(key)
  if (existing) return existing
  let file = yield* storage.get(mediaKeys.siteFile(name, bannerImage.generation))
  if (!file) return undefined
  let bytes = new Uint8Array(yield* Effect.promise(() => file.blob.arrayBuffer()))
  // The app made the banner, so Bun can read it.
  yield* storage.put(key, yield* Effect.orDie(images.resize(bytes, width)))
  return yield* storage.get(key)
})

// The color behind the icon where it can't be transparent, for the web app manifest.
export const siteIconColor = Effect.fn('siteIconColor')(function* (images: SiteImages) {
  if (images.icon) return images.icon.color ?? FALLBACK_ICON_BACKGROUND
  let { defaultIcons } = yield* Images
  return (yield* defaultIcons).image.color ?? FALLBACK_ICON_BACKGROUND
})

const STARTED_AT = Date.now()
