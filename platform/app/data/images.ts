import * as crypto from 'node:crypto'
import sharp from 'sharp'

import type { ImageInfo } from './image-sources.ts'

// Reading and resizing photos with sharp, to the sizes in image-sources.ts.

export async function readImageInfo(file: Blob): Promise<ImageInfo> {
  let bytes = new Uint8Array(await file.arrayBuffer())
  let metadata = await sharp(bytes).metadata()
  let { width, height } = metadata.autoOrient
  let version = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12)
  return { width, height, version }
}

// The image at one of IMAGE_WIDTHS (or its own width, if that's smaller), upright, as WebP.
export async function resizeImage(file: Blob, width: number) {
  let bytes = new Uint8Array(await file.arrayBuffer())
  let resized = await sharp(bytes)
    .autoOrient()
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer()
  return new Uint8Array(resized)
}
