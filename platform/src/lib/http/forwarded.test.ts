// The protocol and host behind a reverse proxy.
import { describe, expect, it } from 'bun:test'

import { getForwardedOrigin } from './forwarded.ts'

describe('getForwardedOrigin', () => {
  // The origin a request through the proxy is seen at.
  let origin = (headers: Record<string, string>) => {
    let lower = Object.fromEntries(
      Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
    )
    let { protocol = 'http', host = '127.0.0.1:44100' } = getForwardedOrigin(lower)
    return new URL(`${protocol}://${host}`).origin
  }

  it('uses X-Forwarded-Proto and X-Forwarded-Host, the first of each', () => {
    expect(origin({ 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'example.com' })).toBe(
      'https://example.com',
    )
    expect(
      origin({ 'X-Forwarded-Proto': 'https, http', 'X-Forwarded-Host': 'example.com, proxy' }),
    ).toBe('https://example.com')
  })

  it('uses the standard Forwarded header when the proxy doesn’t set X-Forwarded-*', () => {
    expect(origin({ Forwarded: 'for=192.0.2.1;proto=https;host=example.com' })).toBe(
      'https://example.com',
    )
    // Quoted values, with delimiters and escapes in them, and the first element that has each.
    expect(
      origin({
        Forwarded: 'for="[2001:db8::1]:4711";Proto="HTTPS";host="example.com:8443", host=b',
      }),
    ).toBe('https://example.com:8443')
    expect(origin({ Forwarded: 'for="a;b,c";host="ex\\ample.com"' })).toBe('http://example.com')
    expect(origin({ Forwarded: 'host=example.com', 'X-Forwarded-Proto': 'https' })).toBe(
      'https://example.com',
    )
  })

  it('lets X-Forwarded-*, which Caddy overwrites, win over a Forwarded header a browser sent', () => {
    expect(
      origin({
        Forwarded: 'proto=http;host=evil.example',
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'example.com',
      }),
    ).toBe('https://example.com')
  })

  it('keeps the ports that are given, and drops the default ones', () => {
    expect(origin({ 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'example.com:443' })).toBe(
      'https://example.com',
    )
    expect(origin({ 'X-Forwarded-Proto': 'https' })).toBe('https://127.0.0.1:44100')
  })

  it('ignores values it can’t use', () => {
    expect(origin({ Forwarded: 'proto=ftp;host=', 'X-Forwarded-Proto': 'gopher' })).toBe(
      'http://127.0.0.1:44100',
    )
    expect(origin({ 'X-Forwarded-Host': 'bad host[' })).toBe('http://127.0.0.1:44100')
    expect(origin({ 'X-Forwarded-Host': 'evil.example/path' })).toBe('http://127.0.0.1:44100')
  })
})
