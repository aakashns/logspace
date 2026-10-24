// The sizes pages show a post's photos at. Pages show a photo at the widths in IMAGE_WIDTHS, made
// from the uploaded file the first time each is asked for (see ../services/images.ts), so a photo
// can be uploaded at any size.

// What a page needs to know about one of a post's images: its size in pixels, upright (as EXIF
// orientation shows it), and a hash of its contents for its URLs.
export interface ImageInfo {
  readonly width: number
  readonly height: number
  readonly version: string
}

// The widths a photo is resized to, in pixels. The steps are close together so the one a browser
// picks for a screen isn't much bigger than it needs: a full-width photo is up to 576px wide (the
// 36rem column) and half that in the feed's grid, at 1x to 3x pixel density.
export const IMAGE_WIDTHS = [320, 400, 480, 600, 680, 800, 960, 1160, 1400, 1600]

// Files that can be resized. GIFs (which may be animated) and other images are served as they are.
const RESIZABLE = /\.(jpe?g|png|webp)$/i

export function isResizableImage(name: string): boolean {
  return RESIZABLE.test(name)
}

// The resized copies of an image and the width of each, for srcset (none for a file that can't be
// resized).
export function getImageSources(name: string, info: ImageInfo) {
  return isResizableImage(name) ? getResizedSources(info) : []
}

// One copy per width in IMAGE_WIDTHS below the image's own, then one at its own width (made from
// the next width up) if that's no wider than the largest. `param` is the width the copy is asked
// for at, like the `w` in its URL.
export function getResizedSources(info: { readonly width: number }) {
  let sources = IMAGE_WIDTHS.filter((width) => width < info.width).map((width) => ({
    param: width,
    width,
  }))
  let next = IMAGE_WIDTHS.find((width) => width >= info.width)
  if (next !== undefined) sources.push({ param: next, width: info.width })
  return sources
}

// An image's srcset, from the URL of its file, or '' if it has no resized copies.
export function getSrcset(url: string, name: string, info: ImageInfo): string {
  return getImageSources(name, info)
    .map((source) => `${url}?w=${source.param}&v=${info.version} ${source.width}w`)
    .join(', ')
}
