// The Web Push protocol: RFC 8291's example message, encrypted byte for byte, any message read
// back as a browser reads it, and the VAPID token push services check.
import { describe, expect, it } from 'bun:test'
import { createECDH, createPublicKey, verify } from 'node:crypto'

import {
  derivePushKeys,
  encryptPushMessage,
  isPushAuthSecret,
  isPushPublicKey,
  MAX_PUSH_PLAINTEXT_BYTES,
  vapidAuthorization,
} from './web-push.ts'
import { decryptPushMessage } from '../../test/web-push.ts'

const bytes = (base64url: string) => new Uint8Array(Buffer.from(base64url, 'base64url'))

// RFC 8291, appendix A.
const RFC = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  serverPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  userAgentPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  userAgentPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  message:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

describe('encryptPushMessage', () => {
  it('encrypts RFC 8291’s example as it does', () => {
    let message = encryptPushMessage(
      bytes(RFC.plaintext),
      { p256dh: RFC.userAgentPublic, auth: RFC.auth },
      { salt: bytes(RFC.salt), privateKey: bytes(RFC.serverPrivate) },
    )
    expect(Buffer.from(message).toString('base64url')).toBe(RFC.message)
  })

  it('makes a message the browser can read, new every time', () => {
    let browser = createECDH('prime256v1')
    browser.generateKeys()
    let keys = { p256dh: browser.getPublicKey().toString('base64url'), auth: RFC.auth }
    let text = new TextEncoder().encode('{"title":"Hello ☀️"}')
    let first = encryptPushMessage(text, keys)
    let second = encryptPushMessage(text, keys)
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(false)
    for (let message of [first, second]) {
      expect(decryptPushMessage(message, browser.getPrivateKey(), RFC.auth)).toEqual(text)
    }
  })

  it('refuses a message too long for push services', () => {
    let keys = { p256dh: RFC.userAgentPublic, auth: RFC.auth }
    expect(encryptPushMessage(new Uint8Array(MAX_PUSH_PLAINTEXT_BYTES), keys).length).toBe(4096)
    expect(() => encryptPushMessage(new Uint8Array(MAX_PUSH_PLAINTEXT_BYTES + 1), keys)).toThrow()
  })
})

describe('derivePushKeys', () => {
  it('derives the same key pair from the same secret, and another from another', () => {
    let keys = derivePushKeys('a-long-session-secret')
    expect(derivePushKeys('a-long-session-secret').publicKey).toBe(keys.publicKey)
    expect(derivePushKeys('another-session-secret').publicKey).not.toBe(keys.publicKey)
    expect(isPushPublicKey(keys.publicKey)).toBe(true)
  })
})

describe('vapidAuthorization', () => {
  it('signs a token for the push service’s origin, which its public key verifies', () => {
    let keys = derivePushKeys('a-long-session-secret')
    let header = vapidAuthorization(
      keys,
      'https://web.push.apple.com/QGuQyavXutnMH8sKeGbm',
      'https://example.com',
      1_800_000_000,
    )
    let [, token = '', key = ''] = /^vapid t=([^,]+), k=(.+)$/.exec(header) ?? []
    expect(key).toBe(keys.publicKey)
    let [head = '', claims = '', signature = ''] = token.split('.')
    let decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString())
    expect(decode(head)).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(decode(claims)).toEqual({
      aud: 'https://web.push.apple.com',
      exp: 1_800_000_000,
      sub: 'https://example.com',
    })
    let point = Buffer.from(key, 'base64url')
    let publicKey = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: point.subarray(1, 33).toString('base64url'),
        y: point.subarray(33).toString('base64url'),
      },
      format: 'jwk',
    })
    let signed = Buffer.from(`${head}.${claims}`)
    let valid = verify(
      'sha256',
      signed,
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url'),
    )
    expect(valid).toBe(true)
  })
})

describe('the keys a subscription has', () => {
  it('takes a point on the curve, and a 16-byte secret', () => {
    expect(isPushPublicKey(RFC.userAgentPublic)).toBe(true)
    // Off the curve.
    let point = bytes(RFC.userAgentPublic)
    point[64] = (point[64] ?? 0) ^ 1
    expect(isPushPublicKey(Buffer.from(point).toString('base64url'))).toBe(false)
    // Compressed, or not base64url.
    expect(isPushPublicKey(Buffer.from(point.subarray(0, 33)).toString('base64url'))).toBe(false)
    expect(isPushPublicKey(`${RFC.userAgentPublic}=`)).toBe(false)
    expect(isPushPublicKey('')).toBe(false)

    expect(isPushAuthSecret(RFC.auth)).toBe(true)
    expect(isPushAuthSecret('BTBZMqHH6r4Tts7J_aSI')).toBe(false)
    expect(isPushAuthSecret('BTBZMqHH6r4Tts7J/aSIgg')).toBe(false)
  })
})
