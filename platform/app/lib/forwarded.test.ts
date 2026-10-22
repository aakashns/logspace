import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { withForwardedUrl } from './forwarded.ts'

// The URL the server sees for a request through the proxy to http://127.0.0.1:44100.
function forwardedUrl(
  headers: Record<string, string>,
  { trustProxy = true, path = '/a?b=1' } = {},
) {
  let request = new Request(`http://127.0.0.1:44100${path}`, { headers })
  return withForwardedUrl(request, { trustProxy }).url
}

describe('withForwardedUrl', () => {
  it('uses the protocol and host in X-Forwarded-Proto and X-Forwarded-Host', () => {
    assert.equal(
      forwardedUrl({ 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'example.com' }),
      'https://example.com/a?b=1',
    )
    // The first of each, which the proxy nearest the browser added.
    assert.equal(
      forwardedUrl({
        'X-Forwarded-Proto': 'https, http',
        'X-Forwarded-Host': 'example.com, proxy',
      }),
      'https://example.com/a?b=1',
    )
  })

  it('uses the standard Forwarded header, which wins over X-Forwarded-*', () => {
    assert.equal(
      forwardedUrl({ Forwarded: 'for=192.0.2.1;proto=https;host=example.com' }),
      'https://example.com/a?b=1',
    )
    assert.equal(
      forwardedUrl({
        Forwarded: 'proto=https;host=example.com',
        'X-Forwarded-Proto': 'http',
        'X-Forwarded-Host': 'other.example',
      }),
      'https://example.com/a?b=1',
    )
    // Quoted values, with delimiters and escapes in them, and the first element that has each.
    assert.equal(
      forwardedUrl({
        Forwarded: 'for="[2001:db8::1]:4711";Proto="HTTPS";host="example.com:8443", host=b',
      }),
      'https://example.com:8443/a?b=1',
    )
    assert.equal(
      forwardedUrl({ Forwarded: 'for="a;b,c";host="ex\\ample.com"' }),
      'http://example.com/a?b=1',
    )
    // A parameter it doesn't have falls back to the X-Forwarded-* header for it.
    assert.equal(
      forwardedUrl({ Forwarded: 'host=example.com', 'X-Forwarded-Proto': 'https' }),
      'https://example.com/a?b=1',
    )
  })

  it('keeps the ports that are given, and drops the default ones', () => {
    assert.equal(
      forwardedUrl({ 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'example.com:8443' }),
      'https://example.com:8443/a?b=1',
    )
    assert.equal(
      forwardedUrl({ 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'example.com:443' }),
      'https://example.com/a?b=1',
    )
    // A forwarded host without a port doesn't keep the server's.
    assert.equal(forwardedUrl({ 'X-Forwarded-Host': 'example.com' }), 'http://example.com/a?b=1')
    // With only the protocol forwarded, the host is the request's own.
    assert.equal(forwardedUrl({ 'X-Forwarded-Proto': 'https' }), 'https://127.0.0.1:44100/a?b=1')
  })

  it('ignores values it can’t use', () => {
    assert.equal(
      forwardedUrl({ Forwarded: 'proto=ftp;host=', 'X-Forwarded-Proto': 'gopher' }),
      'http://127.0.0.1:44100/a?b=1',
    )
    assert.equal(forwardedUrl({ 'X-Forwarded-Host': 'bad host[' }), 'http://127.0.0.1:44100/a?b=1')
  })

  it('keeps a path that starts with // on the forwarded host', () => {
    assert.equal(
      forwardedUrl({ 'X-Forwarded-Host': 'example.com' }, { path: '//evil.example/x' }),
      'http://example.com//evil.example/x',
    )
  })

  it('ignores the headers without trustProxy', () => {
    let headers = { Forwarded: 'proto=https;host=example.com', 'X-Forwarded-Host': 'example.com' }
    assert.equal(forwardedUrl(headers, { trustProxy: false }), 'http://127.0.0.1:44100/a?b=1')
  })

  it('keeps the request’s method, headers, and body', async () => {
    let request = new Request('http://127.0.0.1:44100/admin/login', {
      method: 'POST',
      headers: { 'X-Forwarded-Host': 'example.com', 'Content-Type': 'text/plain' },
      body: 'password=x',
    })
    let forwarded = withForwardedUrl(request, { trustProxy: true })
    assert.equal(forwarded.url, 'http://example.com/admin/login')
    assert.equal(forwarded.method, 'POST')
    assert.equal(forwarded.headers.get('Content-Type'), 'text/plain')
    assert.equal(await forwarded.text(), 'password=x')
  })
})
