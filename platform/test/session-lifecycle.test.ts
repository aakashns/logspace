import { describe, expect, it } from 'bun:test'
import { createHmac } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Clock, Effect, Redacted } from 'effect'
import { SqlClient } from 'effect/sql'

import { ADMIN_PASSWORD, defined, makeTestApp } from './app.ts'

function controlledClock() {
  let now = 1_800_000_000_000
  let baseClock = Effect.runSync(Clock.Clock)
  let clock: Clock.Clock = {
    sleep: (duration) => baseClock.sleep(duration),
    monotonicTimeNanosUnsafe: () => baseClock.monotonicTimeNanosUnsafe(),
    monotonicTimeNanos: baseClock.monotonicTimeNanos,
    currentTimeMillisUnsafe: () => now,
    currentTimeMillis: Effect.sync(() => now),
    currentTimeNanosUnsafe: () => BigInt(now) * 1_000_000n,
    currentTimeNanos: Effect.sync(() => BigInt(now) * 1_000_000n),
  }
  return {
    clock,
    advance: (milliseconds: number) => {
      now += milliseconds
    },
  }
}

describe('server-enforced admin sessions', () => {
  it('rejects replay after logout while another login stays valid', async () => {
    let app = makeTestApp()
    try {
      await app.seedDatabase()
      let cookie = defined(app.sessionCookie(await app.logIn()), 'cookie')
      let other = defined(app.sessionCookie(await app.logIn()), 'other cookie')
      expect((await app.fetch('/admin', { headers: { Cookie: cookie } })).status).toBe(200)
      expect(
        (await app.fetch('/admin/logout', { method: 'POST', headers: { Cookie: cookie } })).status,
      ).toBe(302)
      let replay = await app.fetch('/admin', { headers: { Cookie: cookie } })
      expect(replay.status).toBe(302)
      expect(replay.headers.get('Location')).toBe('/admin/login')
      expect((await app.fetch('/admin', { headers: { Cookie: other } })).status).toBe(200)
    } finally {
      await app.dispose()
    }
  })

  it('expires at 30 days using the server clock, even if the browser retains the cookie', async () => {
    let time = controlledClock()
    let app = makeTestApp({}, time)
    try {
      await app.seedDatabase()
      let cookie = defined(app.sessionCookie(await app.logIn()), 'cookie')
      time.advance(30 * 24 * 60 * 60 * 1000 - 1)
      expect((await app.fetch('/admin', { headers: { Cookie: cookie } })).status).toBe(200)
      // Reading/saving a flash message or revisiting /admin must not extend the server deadline.
      time.advance(1)
      let expired = await app.fetch('/admin', { headers: { Cookie: cookie } })
      expect(expired.status).toBe(302)
      expect(expired.headers.get('Location')).toBe('/admin/login')
      expect((await app.logIn()).status).toBe(302)
    } finally {
      await app.dispose()
    }
  })

  it('refuses tampered, malformed, and correctly signed pre-upgrade cookies without session rows', async () => {
    let app = makeTestApp()
    try {
      await app.seedDatabase()
      let cookie = defined(app.sessionCookie(await app.logIn()), 'cookie')
      let secret = 'test-session-secret'
      let payload = Buffer.from(
        JSON.stringify({
          id: 'old-cookie',
          auth: createHmac('sha256', secret).update(ADMIN_PASSWORD).digest('base64url'),
        }),
      ).toString('base64url')
      let old = `admin_session=${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
      for (let invalid of [`${cookie}x`, `${cookie}.extra`, 'admin_session=bad', old]) {
        let response = await app.fetch('/admin', { headers: { Cookie: invalid } })
        expect(response.status).toBe(302)
        expect(response.headers.get('Location')).toBe('/admin/login')
      }
    } finally {
      await app.dispose()
    }
  })

  it('persists login/logout across restarts and preserves password/secret rotation invalidation', async () => {
    let dir = await mkdtemp(join(tmpdir(), 'logspace-sessions-'))
    let config = { databasePath: join(dir, 'app.sqlite'), cacheDir: dir }
    let app = makeTestApp(config)
    try {
      await app.seedDatabase()
      let cookie = defined(app.sessionCookie(await app.logIn()), 'cookie')
      await app.dispose()
      app = makeTestApp(config)
      expect((await app.fetch('/admin', { headers: { Cookie: cookie } })).status).toBe(200)
      await app.fetch('/admin/logout', { method: 'POST', headers: { Cookie: cookie } })
      await app.dispose()
      app = makeTestApp(config)
      expect(
        (await app.fetch('/admin', { headers: { Cookie: cookie } })).headers.get('Location'),
      ).toBe('/admin/login')
      cookie = defined(app.sessionCookie(await app.logIn()), 'cookie')
      await app.dispose()
      let adminPassword = Redacted.make('a-new-password-1234')
      app = makeTestApp({ ...config, adminPassword })
      expect(
        (await app.fetch('/admin', { headers: { Cookie: cookie } })).headers.get('Location'),
      ).toBe('/admin/login')
      cookie = defined(app.sessionCookie(await app.logIn('a-new-password-1234')), 'cookie')
      await app.dispose()
      app = makeTestApp({
        ...config,
        adminPassword,
        sessionSecret: Redacted.make('a-new-secret-12345'),
      })
      expect(
        (await app.fetch('/admin', { headers: { Cookie: cookie } })).headers.get('Location'),
      ).toBe('/admin/login')
    } finally {
      await app.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('accepts the correct password after repeated failed logins without waiting', async () => {
    let time = controlledClock()
    let app = makeTestApp({}, time)
    try {
      await app.seedDatabase()
      for (let i = 0; i < 20; i++) expect((await app.logIn('wrong')).status).toBe(401)
      // Keep the clock fixed: unrelated failed attempts must not block the owner.
      let login = await app.logIn()
      expect(login.status).toBe(302)
      let cookie = defined(app.sessionCookie(login), 'cookie')
      expect((await app.fetch('/admin', { headers: { Cookie: cookie } })).status).toBe(200)
    } finally {
      await app.dispose()
    }
  })

  it('bounds the stored sessions and prunes expired rows on login', async () => {
    let time = controlledClock()
    let app = makeTestApp({}, time)
    try {
      await app.seedDatabase()
      for (let i = 0; i < 105; i++) await app.logIn()
      let count = () =>
        app.run(
          Effect.flatMap(SqlClient.SqlClient, (sql) =>
            sql<{ n: number }>`select count(*) as n from admin_sessions`.pipe(Effect.orDie),
          ),
        )
      expect((await count())[0]?.n).toBe(100)
      time.advance(30 * 24 * 60 * 60 * 1000)
      await app.logIn()
      expect((await count())[0]?.n).toBe(1)
    } finally {
      await app.dispose()
    }
  })
})
