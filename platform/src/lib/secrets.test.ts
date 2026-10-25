// Sealing secrets for the database with a key derived from AUTH_SESSION_SECRET.
import { afterAll, describe, expect, it } from 'bun:test'
import { Effect, Redacted, Schema } from 'effect'

import { makeTestApp } from '../../test/app.ts'
import { SealedSecret, Secrets } from './secrets.ts'

const app = makeTestApp()
const otherSecret = makeTestApp({ sessionSecret: Redacted.make('another-session-secret') })
// Admin is switched off without a secret, but the app still starts.
const noSecret = makeTestApp({ sessionSecret: Redacted.make('') })
afterAll(async () => {
  await app.dispose()
  await otherSecret.dispose()
  await noSecret.dispose()
})

const seal = (secret: string, purpose = 'test.secret', on = app) =>
  on.run(Effect.flatMap(Secrets, (secrets) => secrets.seal(secret, purpose)))
// The secret, or the error's tag.
const open = (sealed: SealedSecret, purpose = 'test.secret', on = app) =>
  on.run(
    Effect.flatMap(Secrets, (secrets) => secrets.open(sealed, purpose)).pipe(
      Effect.catchTag('SecretUnreadable', (error) => Effect.succeed(error._tag)),
    ),
  )
const isSealed = Schema.is(SealedSecret)

describe('secrets', () => {
  it('seals a secret so it opens again, without it showing, and differently each time', async () => {
    let first = await seal('0x4AAAAAAAsecret-key')
    let second = await seal('0x4AAAAAAAsecret-key')
    expect(first).toMatch(/^v1\.[\w-]{16}\.[\w-]+$/)
    expect(isSealed(first)).toBe(true)
    expect(first).not.toContain('secret-key')
    expect(second).not.toBe(first)
    expect(await open(first)).toBe('0x4AAAAAAAsecret-key')
    expect(await open(second)).toBe('0x4AAAAAAAsecret-key')
  })

  it('opens a secret only for the purpose it was sealed for', async () => {
    let sealed = await seal('a secret', 'turnstile.secretKey')
    expect(await open(sealed, 'turnstile.secretKey')).toBe('a secret')
    expect(await open(sealed, 'email.apiKey')).toBe('SecretUnreadable')
  })

  it('can’t open a secret sealed with another AUTH_SESSION_SECRET', async () => {
    let sealed = await seal('a secret', 'test.secret', otherSecret)
    expect(await open(sealed, 'test.secret', otherSecret)).toBe('a secret')
    expect(await open(sealed)).toBe('SecretUnreadable')
    expect(await open(sealed, 'test.secret', noSecret)).toBe('SecretUnreadable')
    expect(
      await open(await seal('a secret', 'test.secret', noSecret), 'test.secret', noSecret),
    ).toBe('a secret')
  })

  it('can’t open a secret that was altered', async () => {
    let [version, nonce = '', data = ''] = (await seal('a secret')).split('.')
    let flip = (text: string, at: number) =>
      text.slice(0, at) + (text[at] === 'A' ? 'B' : 'A') + text.slice(at + 1)
    for (let altered of [
      `${version}.${flip(nonce, 0)}.${data}`,
      `${version}.${nonce}.${flip(data, 0)}`,
      // The tag, at the end.
      `${version}.${nonce}.${flip(data, data.length - 2)}`,
      `${version}.${nonce}.${data.slice(0, -4)}`,
    ]) {
      expect(isSealed(altered)).toBe(true)
      expect(await open(SealedSecret.make(altered))).toBe('SecretUnreadable')
    }
  })

  it('only takes sealed secrets in its format', () => {
    for (let value of [
      '',
      'a secret',
      'v2.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAA',
      'v1..',
      'v1.a.b',
    ])
      expect(isSealed(value)).toBe(false)
  })
})
