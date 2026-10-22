// The sizes pages show a post's photos at. Pages show a photo at the widths in IMAGE_WIDTHS (see
// getImageSources), made from the uploaded file the first time each is asked for (see
// getPostImageVariant in media.ts, and images.ts for the resizing), so a photo can be uploaded at
// any size.

// What a page needs to know about one of a post's images: its size in pixels, upright (as EXIF
// orientation shows it), and a hash of its contents for its URLs.
export interface ImageInfo {
  width: number
  height: number
  version: string
}

// The widths a photo is resized to, in pixels. The steps are close together so the one a browser
// picks for a screen isn't much bigger than it needs: a full-width photo is up to 576px wide (the
// 36rem column) and half that in the feed's grid, at 1x to 3x pixel density.
export const IMAGE_WIDTHS = [320, 400, 480, 600, 680, 800, 960, 1160, 1400, 1600]

// Files sharp can resize. GIFs (which may be animated) and other images are served as they are.
const RESIZABLE = /\.(jpe?g|png|webp|avif|tiff?)$/i

export function isResizableImage(name: string) {
  return RESIZABLE.test(name)
}

// The URLs of an image's resized copies and the width of each, for srcset: one per width in
// IMAGE_WIDTHS below the image's own, then one at its own width (made from the next width up) if
// that's no wider than the largest.
export function getImageSources(name: string, info: ImageInfo) {
  if (!isResizableImage(name)) return []
  let sources = IMAGE_WIDTHS.filter((width) => width < info.width).map((width) => ({
    param: width,
    width,
  }))
  let next = IMAGE_WIDTHS.find((width) => width >= info.width)
  if (next !== undefined) sources.push({ param: next, width: info.width })
  return sources
}
