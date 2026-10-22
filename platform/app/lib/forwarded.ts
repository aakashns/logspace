// Behind a reverse proxy (e.g. Caddy) a request arrives over plain HTTP from the proxy, so with
// trustProxy its URL is rebuilt from the protocol and host the browser used, which the proxy
// forwards: in the standard Forwarded header, else X-Forwarded-Proto and X-Forwarded-Host. Pages,
// links, and cop()'s same-origin check depend on it. It follows remix/node-fetch-server's
// createRequestListener with trustProxy, which the server used on Node, including which header
// wins and how values are quoted. Only trust these headers from a proxy that overwrites them.
export function withForwardedUrl(
  request: Request,
  { trustProxy }: { trustProxy: boolean },
): Request {
  if (!trustProxy) return request

  let url = new URL(request.url)
  let forwarded = request.headers.get('Forwarded')
  let protocol =
    normalizeProtocol(getForwardedParameter(forwarded, 'proto')) ??
    normalizeProtocol(getFirstValue(request.headers.get('X-Forwarded-Proto'))) ??
    url.protocol
  let host =
    normalizeHost(getForwardedParameter(forwarded, 'host')) ??
    normalizeHost(getFirstValue(request.headers.get('X-Forwarded-Host'))) ??
    url.host
  // Put together as a string, as the adapter does: setting a URL's host keeps its port when the
  // new one has none, and resolving the path against the origin would read a path starting with
  // // as another host.
  let forwardedUrl = URL.parse(`${protocol}//${host}${url.pathname}${url.search}`)
  if (!forwardedUrl || forwardedUrl.href === url.href) return request
  return new Request(forwardedUrl, request)
}

// The first value of a parameter (proto, host) in a Forwarded header, e.g.
// `for=192.0.2.1;proto=https;host=example.com`.
function getForwardedParameter(value: string | null, name: string): string | undefined {
  if (value == null) return undefined
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
function getFirstValue(value: string | null): string | undefined {
  if (value == null) return undefined
  let first = splitHeaderValue(value, ',')[0]
  return first == null ? undefined : unquote(first.trim())
}

function normalizeProtocol(value: string | undefined): string | undefined {
  let protocol = value?.trim().toLowerCase().replace(/:$/, '')
  return protocol === 'http' || protocol === 'https' ? `${protocol}:` : undefined
}

function normalizeHost(value: string | undefined): string | undefined {
  return value?.trim() || undefined
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
