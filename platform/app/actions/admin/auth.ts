import { createHmac, createHash, timingSafeEqual } from 'node:crypto'
import { createCookie } from 'remix/cookie'
import type { Session } from 'remix/session'
import { createCookieSessionStorage } from 'remix/session-storage/cookie'

// /admin is protected by one admin password, ADMIN_PASSWORD. Logging in stores a fingerprint of
// it in a session cookie signed with AUTH_SESSION_SECRET, which signs every session cookie the
// site sets. A user login can share it: those sessions never hold the fingerprint, so they can't
// pass as admin. Both come from the environment (see the README's Deployment section), and
// /admin stays switched off until both are set and long enough.
const MIN_SECRET_LENGTH = 16

const adminPassword = process.env.ADMIN_PASSWORD ?? ''
const authSessionSecret = process.env.AUTH_SESSION_SECRET ?? ''

export const isAdminEnabled =
  adminPassword.length >= MIN_SECRET_LENGTH && authSessionSecret.length >= MIN_SECRET_LENGTH

// Proves the session was started with the current password, so changing ADMIN_PASSWORD logs out
// every browser. Changing AUTH_SESSION_SECRET does too, since old cookies no longer verify.
const passwordFingerprint = createHmac('sha256', authSessionSecret)
  .update(adminPassword)
  .digest('base64url')

export const adminSessionCookie = createCookie('admin_session', {
  // A placeholder keeps the cookie signed while /admin is switched off; it's never used then.
  secrets: [isAdminEnabled ? authSessionSecret : 'disabled'],
  httpOnly: true,
  // Plain HTTP in development; production is only served over HTTPS.
  secure: process.env.NODE_ENV === 'production' ? true : undefined,
  sameSite: 'lax',
  // Only /admin needs the cookie, so public pages never receive it.
  path: '/admin',
  maxAge: 60 * 60 * 24 * 30,
})

export const adminSessionStorage = createCookieSessionStorage()

export function checkAdminPassword(input: unknown) {
  if (!isAdminEnabled || typeof input !== 'string') return false
  // Hashing first gives equal-length buffers, so the comparison takes the same time either way.
  let hash = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(hash(input), hash(adminPassword))
}

export function isAdminLoggedIn(session: Session) {
  return isAdminEnabled && session.get('auth') === passwordFingerprint
}

export function logInAdmin(session: Session) {
  // A new session id on admin login guards against session fixation.
  session.regenerateId()
  session.set('auth', passwordFingerprint)
}
