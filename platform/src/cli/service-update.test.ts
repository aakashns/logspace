import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { BunFileSystem } from '@effect/platform-bun'
import { Effect } from 'effect'
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performServiceUpdate } from './service-update.ts'
import { updateService, updateTimer, updatePath } from './update-units.ts'
import { VERSION } from '../lib/version.ts'

let directory: string
let paths: { request: string; enabled: string; status: string }
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'logspace-update-'))
  paths = {
    request: join(directory, 'request'),
    enabled: join(directory, 'enabled'),
    status: join(directory, 'status'),
  }
})
afterEach(() => rm(directory, { recursive: true, force: true }))
const run = <E, R extends never>(actions: {
  latest: Effect.Effect<string, E, R>
  install: Effect.Effect<void, E, R>
  deploy: Effect.Effect<void, E, R>
}) =>
  Effect.runPromise(performServiceUpdate(actions, paths).pipe(Effect.provide(BunFileSystem.layer)))
const status = () => readFile(paths.status, 'utf8').then((value) => JSON.parse(value))

describe('managed update job', () => {
  it('does nothing when automatic updates are off and no manual request exists', async () => {
    let called = false
    await run({
      latest: Effect.sync(() => {
        called = true
        return '99.0.0'
      }),
      install: Effect.void,
      deploy: Effect.void,
    })
    expect(called).toBe(false)
    expect(
      await access(paths.status).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
  })
  it('consumes manual requests with auto updates off, verifies install before redeploy, and persists success', async () => {
    await writeFile(paths.request, 'ignored command text')
    let events: string[] = []
    await run({
      latest: Effect.succeed('99.0.0'),
      install: Effect.promise(async () => {
        expect((await status()).state).toBe('updating')
        events.push('install')
      }),
      deploy: Effect.sync(() => {
        events.push('deploy')
      }),
    })
    expect(events).toEqual(['install', 'deploy'])
    expect(
      await access(paths.request).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
    expect((await status()).state).toBe('done')
  })
  it('checks enabled automatic updates but never redeploys equal or older releases', async () => {
    await writeFile(paths.enabled, '')
    for (let latest of [VERSION, '0.0.1']) {
      await run({
        latest: Effect.succeed(latest),
        install: Effect.die('must not install'),
        deploy: Effect.die('must not deploy'),
      })
      expect((await status()).state).toBe('done')
    }
  })
  it('persists failure and never deploys when download/verification fails', async () => {
    await writeFile(paths.request, '')
    let deployed = false
    await run({
      latest: Effect.succeed('99.0.0'),
      install: Effect.fail(new Error('checksum mismatch')),
      deploy: Effect.sync(() => {
        deployed = true
      }),
    })
    expect(deployed).toBe(false)
    expect((await status()).state).toBe('error')
  })
  it('reports release lookup and redeploy failures without losing the preference', async () => {
    await writeFile(paths.enabled, '')
    await run({
      latest: Effect.fail(new Error('offline')),
      install: Effect.void,
      deploy: Effect.void,
    })
    expect((await status()).state).toBe('error')
    await run({
      latest: Effect.succeed('99.0.0'),
      install: Effect.void,
      deploy: Effect.fail(new Error('deploy failed')),
    })
    expect((await status()).state).toBe('error')
    await access(paths.enabled)
  })
  it('installs a fixed root job, daily timer, and coalescing path trigger', () => {
    expect(updateService('/usr/local/bin/logspace')).toContain(
      'ExecStart=/usr/local/bin/logspace service-update',
    )
    expect(updateService('/usr/local/bin/logspace')).not.toContain('PartOf=logspace.service')
    expect(updateTimer).toContain('OnCalendar=daily')
    expect(updateTimer).toContain('Persistent=true')
    expect(updatePath).toContain('PathExists=/var/lib/logspace/update-request')
  })
})
