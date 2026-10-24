// What every request goes through.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'

import { makeTestApp } from '../../../test/app.ts'

const app = makeTestApp()

beforeAll(app.seedMedia)
beforeEach(app.seedDatabase)
afterAll(app.dispose)

describe('unknown paths', () => {
  it('answers unknown paths with a 404', async () => {
    let response = await app.fetch('/no-such-page')
    expect(response.status).toBe(404)
    expect((await app.fetch(`/posts/${'a'.repeat(3000)}`)).status).toBe(404)
    expect(response.headers.get('X-Frame-Options')).toBe('DENY')
  })
})
