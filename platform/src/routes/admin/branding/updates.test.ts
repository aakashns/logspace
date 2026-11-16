import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { Effect } from 'effect'
import { makeTestApp } from '../../../../test/app.ts'
import { Updates, type UpdateStatus } from '../../../lib/updates.ts'

let state: UpdateStatus
let requests = 0
const app = makeTestApp(
  {},
  {
    updates: Updates.of({
      status: Effect.sync(() => state),
      request: Effect.sync(() => {
        requests++
        state.pending = true
      }),
      setEnabled: (enabled) =>
        Effect.sync(() => {
          state.enabled = enabled
        }),
    }),
  },
)
beforeEach(async () => {
  await app.seedDatabase()
  state = { current: '0.8.0', latest: '0.8.1', managed: true, enabled: false, pending: false }
  requests = 0
})
afterAll(app.dispose)

describe('update controls', () => {
  it('protects every update endpoint and refuses cross-origin requests', async () => {
    for (let [path, method] of [
      ['/admin/branding/updates', 'GET'],
      ['/admin/branding/updates', 'POST'],
      ['/admin/branding/updates/automatic', 'POST'],
    ] as const) {
      expect((await app.fetch(path, { method })).status).toBe(302)
    }
    let response = await app.adminFetch('/admin/branding/updates', {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
    })
    expect(response.status).toBe(403)
    expect(requests).toBe(0)
  })
  it('shows version, available update, opt-in, and persists the preference through its command', async () => {
    let html = await (await app.adminFetch('/admin/branding')).text()
    expect(html).toContain('0.8.0')
    expect(html).toContain('0.8.1 is available')
    expect(html).toContain('Update now')
    let saved = await app.adminFetch('/admin/branding/updates/automatic', {
      method: 'POST',
      body: new URLSearchParams({ enabled: 'on' }),
    })
    expect(saved.headers.get('Content-Type')).toContain('text/event-stream')
    expect(state.enabled).toBe(true)
    await app.adminFetch('/admin/branding/updates/automatic', {
      method: 'POST',
      body: new URLSearchParams(),
    })
    expect(state.enabled).toBe(false)
  })
  it('returns status patches without cache and shows pending requests', async () => {
    await app.adminFetch('/admin/branding/updates', { method: 'POST' })
    expect(requests).toBe(1)
    let response = await app.adminFetch('/admin/branding/updates')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.text()).toContain('Update requested')
  })
  it('shows current installations and handles unavailable release checks honestly', async () => {
    state.latest = state.current
    let html = await (await app.adminFetch('/admin/branding')).text()
    expect(html).toContain('latest version')
    expect(html).not.toContain('>Update now<')
    state.latest = undefined
    state.error = 'Could not check for updates. Try again later.'
    html = await (await app.adminFetch('/admin/branding')).text()
    expect(html).toContain('Could not check for updates')
    expect(html).not.toContain('latest version')
  })
})

it('gives a useful error on unmanaged installations', async () => {
  const unmanaged = makeTestApp()
  try {
    await unmanaged.seedDatabase()
    let response = await unmanaged.adminFetch('/admin/branding/updates', { method: 'POST' })
    expect(await response.text()).toContain('Run sudo logspace deploy')
  } finally {
    await unmanaged.dispose()
  }
})
