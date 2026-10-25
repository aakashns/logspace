// /dev: a card for each tool for working on the app, none of which production serves.
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'

import { makeTestApp } from '../../../../test/app.ts'

const app = makeTestApp()
const production = makeTestApp({ mode: 'production' })

beforeEach(async () => {
  await app.seedDatabase()
  await production.seedDatabase()
})
afterAll(async () => {
  await app.dispose()
  await production.dispose()
})

describe('/dev', () => {
  it('links to each tool with a card', async () => {
    let response = await app.fetch('/dev')
    let html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toContain('<meta name="robots" content="noindex">')
    let links = [
      ...html.matchAll(/<a href="([^"]+)" class="link-card">.*?<h2[^>]*>([^<]+)<\/h2>/g),
    ].map(([, href, title]) => [href, title])
    expect(links).toEqual([
      ['/dev/design', 'Design'],
      ['/dev/emails', 'Emails'],
    ])
  })

  it('is served before the site is configured, as the admin is', async () => {
    let unconfigured = makeTestApp()
    try {
      expect((await unconfigured.fetch('/dev')).status).toBe(200)
      expect((await unconfigured.fetch('/dev/emails')).status).toBe(200)
    } finally {
      await unconfigured.dispose()
    }
  })

  it('isn’t served in production, nor anything under it', async () => {
    for (let path of ['/dev', '/dev/design', '/dev/emails']) {
      expect((await production.fetch(path)).status).toBe(404)
    }
    let ses = await production.fetch('/dev/ses/v2/email/outbound-emails', {
      method: 'POST',
      body: '{}',
    })
    expect(ses.status).toBe(404)
  })
})
