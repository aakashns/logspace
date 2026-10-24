// The URLs pages link the site's images with: the icon's files, the logos, and the banner image.
// Each has the image's version, so a new upload gets new URLs and browsers can keep each for good.
import { routes } from '../routes.ts'
import { getSrcset } from './images.ts'
import type { SiteImage, SiteImages } from './site.ts'

// The version of LogSpace's mark (../services/default-icon.png), the icon until one is uploaded: a
// hash of the file, like an upload's version (test/config.test.ts checks it's current).
export const DEFAULT_ICON_VERSION = '875e8f1b6795'

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
