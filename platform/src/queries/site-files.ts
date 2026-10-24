// The files the site serves for its images: the icons (favicon, home screen and manifest icons),
// the logos, and the banner image, with the banner's resized copies. Icons are made from
// LogSpace's mark until an icon is uploaded.
import { Context, Effect, Layer } from 'effect'

import { FALLBACK_ICON_BACKGROUND } from '../domain/constants.ts'
import { IMAGE_WIDTHS, getSrcset } from '../domain/images.ts'
import type { SiteImage, SiteImages } from '../domain/site.ts'
import { routes } from '../routes.ts'
import { DEFAULT_ICON_VERSION, ICON_FILES, Images } from '../services/images.ts'
import { MediaStorage, mediaKeys, type StoredFile } from '../services/media-storage.ts'

export class SiteFiles extends Context.Service<
  SiteFiles,
  {
    // One of the site's image files with its current version, or undefined if there's no such
    // file.
    readonly get: (
      name: string,
      images: SiteImages,
    ) => Effect.Effect<{ file: StoredFile; version: string } | undefined>
    // The banner image resized to one of IMAGE_WIDTHS, as WebP, if `name` and `version` are its
    // current ones. Copies are made the first time each is asked for, like a post's photos'.
    readonly resized: (
      name: string,
      width: number,
      version: string,
      images: SiteImages,
    ) => Effect.Effect<StoredFile | undefined>
    // The color behind the icon where it can't be transparent, for the web app manifest.
    readonly iconColor: (images: SiteImages) => Effect.Effect<string>
  }
>()('logspace/SiteFiles') {
  static readonly layer = Layer.effect(
    SiteFiles,
    Effect.gen(function* () {
      let storage = yield* MediaStorage
      let { defaultIcons, resize } = yield* Images
      let stored = (name: string, version: string, generation?: string) =>
        Effect.map(
          storage.get(mediaKeys.siteFile(name, generation)),
          (file) => file && { file, version },
        )

      return SiteFiles.of({
        get: Effect.fn('SiteFiles.get')(function* (name, images) {
          if (ICON_FILES.includes(name)) {
            if (images.icon) return yield* stored(name, images.icon.version, images.icon.generation)
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
        }),
        // Unlike PostMedia, two requests for a copy that isn't made yet both make it: there's
        // only one banner, and its copies are each asked for about once.
        resized: Effect.fn('SiteFiles.resized')(function* (name, width, version, { bannerImage }) {
          if (bannerImage?.file !== name || bannerImage.version !== version) return undefined
          if (!IMAGE_WIDTHS.includes(width)) return undefined
          let key = `${mediaKeys.siteVariants(name)}${width}-${version}.webp`
          let existing = yield* storage.get(key)
          if (existing) return existing
          let file = yield* storage.get(mediaKeys.siteFile(name, bannerImage.generation))
          if (!file) return undefined
          let bytes = new Uint8Array(yield* Effect.promise(() => file.blob.arrayBuffer()))
          // The app made the banner, so Bun can read it.
          yield* storage.put(key, yield* Effect.orDie(resize(bytes, width)))
          return yield* storage.get(key)
        }),
        iconColor: (images) =>
          images.icon
            ? Effect.succeed(images.icon.color ?? FALLBACK_ICON_BACKGROUND)
            : Effect.map(defaultIcons, (icons) => icons.image.color ?? FALLBACK_ICON_BACKGROUND),
      })
    }),
  )
}

const STARTED_AT = Date.now()

// The URL of one of the icon's files, with its version, so a new icon gets new URLs.
export function getIconHref(images: SiteImages, name: string): string {
  let version = images.icon?.version ?? DEFAULT_ICON_VERSION
  let path =
    name === 'favicon.ico'
      ? routes.favicon()
      : name === 'apple-touch-icon.png'
        ? routes.appleTouchIcon()
        : routes.siteFile(name)
  return `${path}?v=${version}`
}

// The URL of a logo or the banner image.
export function getSiteImageHref(image: SiteImage): string {
  return `${routes.siteFile(image.file)}?v=${image.version}`
}

// The banner image's resized copies, for srcset.
export function getBannerSrcset(image: SiteImage): string {
  return getSrcset(routes.siteFile(image.file), image.file, image)
}
