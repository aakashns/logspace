// Secrets the site stores, like an integration's secret key, are kept in the database encrypted
// (AES-256-GCM) with a key derived from AUTH_SESSION_SECRET, so a copy of the database alone, like
// a backup, doesn't give them away. Each is sealed for a purpose, like "turnstile.secretKey", and
// opens only for that one, so a sealed value can't be moved to another setting. Changing
// AUTH_SESSION_SECRET leaves the saved ones unreadable, so they have to be entered again.
//
// Values the site gives out, like the account in a link to unsubscribe, are signed (HMAC-SHA256)
// with another key derived from it, so only the site can make a link that's accepted. They're
// signed for a purpose too, and changing AUTH_SESSION_SECRET leaves the old signatures wrong.
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import { Context, Effect, Layer, Redacted, Schema } from 'effect'

import { AppConfig } from './config.ts'

// "v1.<nonce>.<ciphertext and tag>", base64url: a 12-byte nonce, and the 16-byte tag after the
// ciphertext of a secret that isn't empty. The version leaves room for another scheme.
export const SealedSecret = Schema.String.check(
  Schema.isPattern(/^v1\.[\w-]{16}\.[\w-]{23,}$/),
).pipe(Schema.brand('SealedSecret'))
export type SealedSecret = typeof SealedSecret.Type

// A sealed secret didn't open: AUTH_SESSION_SECRET changed since it was saved, or it was altered.
export class SecretUnreadable extends Schema.TaggedError<SecretUnreadable>()(
  'SecretUnreadable',
  {},
) {}

const TAG_BYTES = 16
// A signature's first 16 bytes, 22 characters in base64url, as many as a link needs to be
// unguessable.
const SIGNATURE_BYTES = 16

export class Secrets extends Context.Service<
  Secrets,
  {
    readonly seal: (secret: string, purpose: string) => Effect.Effect<SealedSecret>
    readonly open: (
      sealed: SealedSecret,
      purpose: string,
    ) => Effect.Effect<string, SecretUnreadable>
    // The signature of `value` for `purpose`, and whether `signature` is it.
    readonly sign: (value: string, purpose: string) => string
    readonly verify: (value: string, signature: string, purpose: string) => boolean
  }
>()('logspace/Secrets') {
  static readonly layer = Layer.effect(
    Secrets,
    Effect.map(AppConfig, ({ sessionSecret }) => {
      // Keys of their own, so neither is the one that signs session cookies.
      let key = Buffer.from(
        hkdfSync('sha256', Redacted.value(sessionSecret), 'logspace', 'stored secrets v1', 32),
      )
      let signingKey = Buffer.from(
        hkdfSync('sha256', Redacted.value(sessionSecret), 'logspace', 'signatures v1', 32),
      )
      // The purpose and value, with a byte neither has between them, so no two pairs sign alike.
      let sign = (value: string, purpose: string) =>
        createHmac('sha256', signingKey)
          .update(`${purpose}\0${value}`)
          .digest()
          .subarray(0, SIGNATURE_BYTES)
          .toString('base64url')
      return Secrets.of({
        seal: (secret, purpose) =>
          Effect.sync(() => {
            let nonce = randomBytes(12)
            let cipher = createCipheriv('aes-256-gcm', key, nonce).setAAD(Buffer.from(purpose))
            let sealed = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
            let data = Buffer.concat([sealed, cipher.getAuthTag()])
            return SealedSecret.make(
              `v1.${nonce.toString('base64url')}.${data.toString('base64url')}`,
            )
          }),
        open: (sealed, purpose) =>
          Effect.try({
            try: () => {
              let [, nonce = '', data = ''] = sealed.split('.')
              let bytes = Buffer.from(data, 'base64url')
              let decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64url'))
                .setAAD(Buffer.from(purpose))
                .setAuthTag(bytes.subarray(-TAG_BYTES))
              let plain = Buffer.concat([
                decipher.update(bytes.subarray(0, -TAG_BYTES)),
                decipher.final(),
              ])
              return plain.toString('utf8')
            },
            catch: () => new SecretUnreadable(),
          }),
        sign,
        verify: (value, signature, purpose) => {
          let given = Buffer.from(signature)
          let expected = Buffer.from(sign(value, purpose))
          return given.length === expected.length && timingSafeEqual(given, expected)
        },
      })
    }),
  )
}
