// Behind a reverse proxy (Caddy) a request arrives over plain HTTP from the proxy, so with
// TRUST_PROXY=1 its protocol and host are the ones the browser used, which the proxy forwards: in
// X-Forwarded-Proto and X-Forwarded-Host, else the standard Forwarded header. Pages, links, and
// the cross-origin check depend on them. Only trust these headers from a proxy that overwrites
// them. Caddy sets the X-Forwarded-* headers on every request but passes a browser's Forwarded
// header through, so those win. (In LogSpace 0.1 Forwarded won, which let a browser choose the
// host the app saw.)

export interface ForwardedOrigin {
  readonly protocol?: 'http' | 'https' | undefined
  readonly host?: string | undefined
}

export function getForwardedOrigin(
  headers: Readonly<Record<string, string | undefined>>,
): ForwardedOrigin {
  let forwarded = headers['forwarded']
  let protocol =
    normalizeProtocol(getFirstValue(headers['x-forwarded-proto'])) ??
    normalizeProtocol(getForwardedParameter(forwarded, 'proto'))
  let host =
    normalizeHost(getFirstValue(headers['x-forwarded-host'])) ??
    normalizeHost(getForwardedParameter(forwarded, 'host'))
  return { protocol, host }
}

// The first value of a parameter (proto, host) in a Forwarded header, e.g.
// `for=192.0.2.1;proto=https;host=example.com`.
function getForwardedParameter(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined
  for (let element of splitHeaderValue(value, ',')) {
    for (let parameter of splitHeaderValue(element, ';')) {
      let index = parameter.indexOf('=')
      if (index === -1 || parameter.slice(0, index).trim().toLowerCase() !== name) continue
      return unquote(parameter.slice(index + 1).trim())
    }
  }
  return undefined
}

// The first of a header's comma-separated values (each proxy along the way adds one).
function getFirstValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  let first = splitHeaderValue(value, ',')[0]
  return first === undefined ? undefined : unquote(first.trim())
}

function normalizeProtocol(value: string | undefined): 'http' | 'https' | undefined {
  let protocol = value?.trim().toLowerCase().replace(/:$/, '')
  return protocol === 'http' || protocol === 'https' ? protocol : undefined
}

// A host, with a port if it has one, that can't be anything else: no paths or credentials.
function normalizeHost(value: string | undefined): string | undefined {
  let host = value?.trim()
  return host && /^[^\s/?#@\\]+$/.test(host) && URL.canParse(`http://${host}/`) ? host : undefined
}

// Splits a header value at a delimiter outside quoted strings.
function splitHeaderValue(value: string, delimiter: string): string[] {
  let parts: string[] = []
  let start = 0
  let quoted = false
  let escaped = false
  for (let index = 0; index < value.length; index++) {
    let char = value[index]
    if (escaped) {
      escaped = false
    } else if (quoted && char === '\\') {
      escaped = true
    } else if (char === '"') {
      quoted = !quoted
    } else if (!quoted && char === delimiter) {
      parts.push(value.slice(start, index))
      start = index + 1
    }
  }
  parts.push(value.slice(start))
  return parts
}

function unquote(value: string): string {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) return value
  return value.slice(1, -1).replace(/\\(.)/g, '$1')
}
