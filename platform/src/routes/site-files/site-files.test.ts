// The site's files: the web app manifest and icons.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { Schema } from 'effect'

import { makeTestApp } from '../../../test/app.ts'

const app = makeTestApp()

beforeAll(app.seedMedia)
beforeEach(app.seedDatabase)
afterAll(app.dispose)

describe('the site’s files', () => {
  it('site.webmanifest is named after the site', async () => {
    let response = await app.fetch('/site.webmanifest')
    expect(response.headers.get('Content-Type')).toMatch(/application\/manifest\+json/)
    let manifest = Schema.decodeUnknownSync(
      Schema.Struct({ name: Schema.String, icons: Schema.Array(Schema.Unknown) }),
    )(await response.json())
    expect(manifest.name).toBe('Test Site')
    expect(manifest.icons.length).toBe(2)
  })

  it('serves LogSpace’s icons until one is uploaded', async () => {
    for (let path of [
      '/favicon.ico',
      '/apple-touch-icon.png',
      '/site/icon-192.png',
      '/site/icon-512.png',
    ]) {
      let response = await app.fetch(path)
      expect(response.status).toBe(200)
      await response.body?.cancel()
    }
    expect((await app.fetch('/site/favicon.ico')).status).toBe(404)
    expect((await app.fetch('/site/logo.webp')).status).toBe(404)
  })
})
