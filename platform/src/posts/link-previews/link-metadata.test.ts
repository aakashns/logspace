// Reading a linked page's metadata.
import { describe, expect, it } from 'bun:test'

import { parseLinkMetadata } from './link-metadata.ts'

describe('parseLinkMetadata', () => {
  it('reads Open Graph tags', () => {
    let html = `<html><head>
      <title>Fallback</title>
      <meta property="og:title" content="Tom &amp; Jerry&#39;s">
      <meta content='A description' property='og:description'>
      <meta property="og:image" content="/share.png">
      </head><body><meta property="og:title" content="Not this"></body></html>`
    expect(parseLinkMetadata(html, 'https://example.com/page')).toEqual({
      title: "Tom & Jerry's",
      description: 'A description',
      image: 'https://example.com/share.png',
    })
  })

  it('falls back to <title>, the meta description, and Twitter card tags', () => {
    let html = `<head><title>Page title</title><meta name="description" content="About it">
      <meta name="twitter:card" content="summary">
      <meta name="twitter:image" content="http://cdn.example.com/a.jpg"></head>`
    expect(parseLinkMetadata(html, 'https://example.com')).toEqual({
      title: 'Page title',
      description: 'About it',
      image: 'https://cdn.example.com/a.jpg',
      smallImage: true,
    })
  })

  it('ignores images that are not http(s)', () => {
    let html = `<head><meta property="og:image" content="javascript:alert(1)"></head>`
    expect(parseLinkMetadata(html, 'https://example.com').image).toBeUndefined()
  })
})
