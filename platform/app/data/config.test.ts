import * as assert from 'remix/assert'
import { beforeAll, describe, it } from 'remix/test'

import { router } from '../router.ts'
import { routes } from '../routes.ts'
import { seedDatabase, TEST_SITE_CONFIG } from '../../test/seed.ts'
import { getSiteConfig, loadSiteConfig, saveSiteConfig } from './config.ts'
import { db } from './db.ts'
import { config } from './tables.ts'

function fetch(path: string) {
  return router.fetch(new Request(new URL(path, 'http://localhost')))
}

// Requests until one has the title, since each request reads the config again for later ones.
async function fetchTitle(title: string) {
  for (let i = 0; i < 3; i++) {
    let html = await (await fetch(routes.home.href())).text()
    if (html.includes(`<title>${title}</title>`)) return i + 1
  }
  return undefined
}

beforeAll(async () => {
  await seedDatabase()
})

describe('site config', () => {
  it('picks up a change made in the database without a restart', async () => {
    assert.equal(await fetchTitle(TEST_SITE_CONFIG.siteTitle), 1)
    try {
      await db.update(config, { key: 'siteTitle' }, { value: 'Changed Elsewhere' })
      let requests = await fetchTitle('Changed Elsewhere')
      assert.ok(requests !== undefined && requests <= 2, `took ${requests} requests`)
      assert.equal(getSiteConfig().siteTitle, 'Changed Elsewhere')
    } finally {
      await saveSiteConfig(TEST_SITE_CONFIG)
    }
  })

  it('keeps the last config when reading it again fails', async (t) => {
    let error = t.mock.method(console, 'error', () => {})
    let findMany = db.findMany.bind(db)
    t.mock.method(db, 'findMany', (...args: Parameters<typeof db.findMany>) =>
      args[0] === config ? Promise.reject(new Error('Database unavailable')) : findMany(...args),
    )
    for (let i = 0; i < 3; i++) {
      let response = await fetch(routes.home.href())
      assert.equal(response.status, 200)
      assert.match(await response.text(), /<title>Test Site<\/title>/)
    }
    assert.ok(error.mock.calls.length > 0)
    assert.deepEqual(getSiteConfig(), TEST_SITE_CONFIG)
  })

  it('a save isn’t undone by a read that started before it', async (t) => {
    // Reads that finish after the save, with what was in the database before it.
    let findMany = db.findMany.bind(db)
    t.mock.method(db, 'findMany', async (...args: Parameters<typeof db.findMany>) => {
      let rows = await findMany(...args)
      await new Promise((resolve) => setTimeout(resolve, 20))
      return rows
    })
    try {
      await loadSiteConfig()
      await saveSiteConfig({ ...TEST_SITE_CONFIG, siteTitle: 'Just Saved' })
      await new Promise((resolve) => setTimeout(resolve, 40))
      assert.equal(getSiteConfig().siteTitle, 'Just Saved')
    } finally {
      await saveSiteConfig(TEST_SITE_CONFIG)
    }
  })
})
