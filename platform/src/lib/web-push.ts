// The Web Push protocol, as the site speaks it to browsers' push services (Apple's, Google's,
// Mozilla's, Microsoft's): the site's key pair, a message encrypted for one browser (RFC 8291,
// with RFC 8188's aes128gcm), and the signed token that says it's from the site (VAPID, RFC 8292).
// Sending it is ../data/push/delivery.ts's.
// https://www.rfc-editor.org/rfc/rfc8291
// https://www.rfc-editor.org/rfc/rfc8292
import {
  createECDH,
  createPrivateKey,
  createPublicKey,
  createCipheriv,
  type KeyObject,
  hkdfSync,
  randomBytes,
  sign,
} from 'node:crypto'

// The site's P-256 key pair, which browsers subscribe with (`publicKey`, as PushManager.subscribe
// takes it, as `applicationServerKey`) and push services check each message's token with.
export interface PushKeys {
  // The uncompressed point (65 bytes), base64url.
  readonly publicKey: string
  readonly privateKey: KeyObject
}

// The key pair, derived from AUTH_SESSION_SECRET (as ./secrets.ts derives its key), so there's
// nothing to generate, store, or enter. A browser's subscription is for one key: changing the
// secret changes it, and browsers subscribe again on their next visit (see
// ../../public/push-notifications.js). HKDF's 32 bytes are a valid private key unless they're at
// least the curve's order, which is about 2⁻³² likely.
export function derivePushKeys(secret: string): PushKeys {
  let d = Buffer.from(hkdfSync('sha256', secret, 'logspace', 'web push key v1', 32))
  let ecdh = createECDH('prime256v1')
  ecdh.setPrivateKey(d)
  let point = ecdh.getPublicKey()
  return {
    publicKey: point.toString('base64url'),
    privateKey: createPrivateKey({
      key: { ...toJwk(point), d: d.toString('base64url') },
      format: 'jwk',
    }),
  }
}

// A P-256 point's coordinates, as a JWK has them.
function toJwk(point: Buffer) {
  return {
    kty: 'EC',
    crv: 'P-256',
    x: point.subarray(1, 33).toString('base64url'),
    y: point.subarray(33, 65).toString('base64url'),
  }
}

// Whether `key` (base64url) is a browser's P-256 public key, as PushSubscription's `p256dh` is:
// an uncompressed point (65 bytes, starting 0x04) on the curve.
export function isPushPublicKey(key: string): boolean {
  let point = Buffer.from(key, 'base64url')
  if (point.length !== 65 || point[0] !== 0x04 || point.toString('base64url') !== key) return false
  try {
    createPublicKey({ key: toJwk(point), format: 'jwk' })
    return true
  } catch {
    return false
  }
}

// Whether `secret` (base64url) is a browser's authentication secret, as PushSubscription's `auth`
// is: 16 bytes.
export function isPushAuthSecret(secret: string): boolean {
  let bytes = Buffer.from(secret, 'base64url')
  return bytes.length === 16 && bytes.toString('base64url') === secret
}

// The record size the message says it's in. It's one record, so any size it fits in will do.
const RECORD_SIZE = 4096
// The header: a 16-byte salt, the record size (4 bytes), and the key's length (1) and the key (65).
const HEADER_BYTES = 86
// Push services take messages of up to 4096 bytes: the header, the plaintext, the padding
// delimiter (1), and AES-GCM's tag (16).
export const MAX_PUSH_PLAINTEXT_BYTES = 4096 - HEADER_BYTES - 1 - 16

// `plaintext`, encrypted for the browser whose subscription has these keys (RFC 8291, section 3),
// as one aes128gcm record (RFC 8188) with no padding. The salt and the key pair it's encrypted
// with are new for every message; the tests pass RFC 8291's.
export function encryptPushMessage(
  plaintext: Uint8Array,
  keys: { readonly p256dh: string; readonly auth: string },
  fixed?: { readonly salt: Uint8Array; readonly privateKey: Uint8Array },
): Uint8Array {
  if (plaintext.length > MAX_PUSH_PLAINTEXT_BYTES) {
    throw new Error(`A push message can be ${MAX_PUSH_PLAINTEXT_BYTES} bytes at most`)
  }
  let userAgentPublic = Buffer.from(keys.p256dh, 'base64url')
  let authSecret = Buffer.from(keys.auth, 'base64url')
  let salt = fixed ? Buffer.from(fixed.salt) : randomBytes(16)
  let ecdh = createECDH('prime256v1')
  if (fixed) ecdh.setPrivateKey(Buffer.from(fixed.privateKey))
  else ecdh.generateKeys()
  let serverPublic = ecdh.getPublicKey()
  let sharedSecret = ecdh.computeSecret(userAgentPublic)

  let keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), userAgentPublic, serverPublic])
  let ikm = hkdfSync('sha256', sharedSecret, authSecret, keyInfo, 32)
  let contentKey = hkdfSync('sha256', ikm, salt, 'Content-Encoding: aes128gcm\0', 16)
  let nonce = hkdfSync('sha256', ikm, salt, 'Content-Encoding: nonce\0', 12)

  let cipher = createCipheriv('aes-128-gcm', Buffer.from(contentKey), Buffer.from(nonce))
  // 0x02 ends the last (and only) record.
  let ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.update(Buffer.from([0x02])),
    cipher.final(),
    cipher.getAuthTag(),
  ])
  let header = Buffer.alloc(HEADER_BYTES - serverPublic.length)
  salt.copy(header, 0)
  header.writeUInt32BE(RECORD_SIZE, 16)
  header.writeUInt8(serverPublic.length, 20)
  return new Uint8Array(Buffer.concat([header, serverPublic, ciphertext]))
}

// The Authorization header for a message to `endpoint` (RFC 8292): a JWT, signed with the site's
// private key (ES256), for the push service's origin, until `expiresAt` (seconds since 1970, at
// most a day away), naming `subject`, a URL or mailto: address the push service can contact the
// site at, and the site's public key.
export function vapidAuthorization(
  keys: PushKeys,
  endpoint: string,
  subject: string,
  expiresAt: number,
): string {
  let encode = (data: object) => Buffer.from(JSON.stringify(data)).toString('base64url')
  let unsigned = `${encode({ typ: 'JWT', alg: 'ES256' })}.${encode({
    aud: new URL(endpoint).origin,
    exp: expiresAt,
    sub: subject,
  })}`
  let signature = sign('sha256', Buffer.from(unsigned), {
    key: keys.privateKey,
    dsaEncoding: 'ieee-p1363',
  })
  return `vapid t=${unsigned}.${signature.toString('base64url')}, k=${keys.publicKey}`
}
