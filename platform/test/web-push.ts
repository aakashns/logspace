// A push message as a browser reads it (RFC 8291, with RFC 8188's aes128gcm), written apart from
// the site's encryptPushMessage, so the tests check one against the other.
import { createDecipheriv, createECDH, hkdfSync } from 'node:crypto'

// The message's plaintext, for the browser with this private key and auth secret.
export function decryptPushMessage(
  message: Uint8Array,
  privateKey: Uint8Array,
  auth: string,
): Uint8Array {
  let data = Buffer.from(message)
  let salt = data.subarray(0, 16)
  let keyLength = data.readUInt8(20)
  let serverPublic = data.subarray(21, 21 + keyLength)
  let ciphertext = data.subarray(21 + keyLength)
  let browser = createECDH('prime256v1')
  browser.setPrivateKey(Buffer.from(privateKey))
  let info = Buffer.concat([Buffer.from('WebPush: info\0'), browser.getPublicKey(), serverPublic])
  let ikm = hkdfSync(
    'sha256',
    browser.computeSecret(serverPublic),
    Buffer.from(auth, 'base64url'),
    info,
    32,
  )
  let key = hkdfSync('sha256', ikm, salt, 'Content-Encoding: aes128gcm\0', 16)
  let nonce = hkdfSync('sha256', ikm, salt, 'Content-Encoding: nonce\0', 12)
  let decipher = createDecipheriv('aes-128-gcm', Buffer.from(key), Buffer.from(nonce))
  decipher.setAuthTag(ciphertext.subarray(-16))
  let padded = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()])
  // The last record ends with 0x02, after any padding of zeros.
  let end = padded.lastIndexOf(0x02)
  if (end === -1 || padded.subarray(end + 1).some((byte) => byte !== 0)) {
    throw new Error('Expected the last record’s delimiter')
  }
  return new Uint8Array(padded.subarray(0, end))
}
