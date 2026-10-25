// `logspace turnstile on|off`, on a database made by `logspace migrate`.
import { Database } from 'bun:sqlite'
import { afterAll, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { BunServices } from '@effect/platform-bun'
import { ConfigProvider, Effect, Exit } from 'effect'

import { migrate } from './migrate.ts'
import { turnstile } from './turnstile.ts'

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'logspace-turnstile-'))
const file = path.join(dir, 'app.sqlite')
afterAll(() => fs.rm(dir, { recursive: true, force: true }))

const run = <A, E>(effect: Effect.Effect<A, E, BunServices.BunServices>, databasePath = file) =>
  Effect.runPromiseExit(
    effect.pipe(
      Effect.provide(BunServices.layer),
      Effect.provide(
        ConfigProvider.layer(ConfigProvider.fromEnv({ env: { DATABASE_PATH: databasePath } })),
      ),
    ),
  )
const failure = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? String(exit.cause) : 'succeeded'
const saved = () => {
  let db = new Database(file)
  let row = db
    .query<{ value: string }, []>(`select value from config where key = 'turnstile'`)
    .get()
  db.close()
  return row && JSON.parse(row.value)
}

describe('logspace turnstile', () => {
  it('needs a database', async () => {
    let exit = await run(turnstile('off'), path.join(dir, 'missing.sqlite'))
    expect(failure(exit)).toContain("There's no database at")
  })

  it('can’t turn on what isn’t set up, and off is already done', async () => {
    expect(Exit.isSuccess(await run(migrate(false)))).toBe(true)
    expect(failure(await run(turnstile('on')))).toContain('Turnstile isn’t set up.')
    expect(Exit.isSuccess(await run(turnstile('off')))).toBe(true)
    expect(saved()).toBeNull()
  })

  it('sets the Enabled checkbox, keeping the keys', async () => {
    let keys = { siteKey: '0x4AAAAAAAsiteKey123', secretKey: 'v1.sealed.secret', enabled: false }
    let db = new Database(file)
    db.run(`insert into config (key, value) values ('turnstile', ?)`, [JSON.stringify(keys)])
    db.close()

    expect(Exit.isSuccess(await run(turnstile('on')))).toBe(true)
    expect(saved()).toEqual({ ...keys, enabled: true })
    expect(Exit.isSuccess(await run(turnstile('off')))).toBe(true)
    expect(saved()).toEqual({ ...keys, enabled: false })
  })
})
