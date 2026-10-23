// The files the site serves for its images: the icons (favicon, home screen and manifest icons),
// the logo, and the social preview image. Icons are made from LogSpace's mark until an icon is
// uploaded.
import { Context, Effect, Layer } from 'effect'

import { FALLBACK_ICON_BACKGROUND } from '../domain/constants.ts'
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
    // The color behind the icon where it can't be transparent, for the web app manifest.
    readonly iconColor: (images: SiteImages) => Effect.Effect<string>
  }
>()('logspace/SiteFiles') {
  static readonly layer = Layer.effect(
    SiteFiles,
    Effect.gen(function* () {
      let storage = yield* MediaStorage
      let { defaultIcons } = yield* Images
      let stored = (name: string, version: string) =>
        Effect.map(storage.get(mediaKeys.siteFile(name)), (file) => file && { file, version })

      return SiteFiles.of({
        get: Effect.fn('SiteFiles.get')(function* (name, images) {
          if (ICON_FILES.includes(name)) {
            if (images.icon) return yield* stored(name, images.icon.version)
            let icon = (yield* defaultIcons).files.find((file) => file.name === name)
            if (!icon) return undefined
            let blob = new Blob([icon.bytes], { type: icon.type })
            let file = { blob, size: blob.size, type: icon.type, lastModified: STARTED_AT }
            return { file, version: DEFAULT_ICON_VERSION }
          }
          let image = [images.logo, images.socialImage].find((image) => image?.file === name)
          return image ? yield* stored(name, image.version) : undefined
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

// The URL of the logo or social preview image.
export function getSiteImageHref(image: SiteImage): string {
  return `${routes.siteFile(image.file)}?v=${image.version}`
}
