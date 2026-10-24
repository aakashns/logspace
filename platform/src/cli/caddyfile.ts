// Adds the site's blocks to a Caddyfile for `logspace deploy`, replacing any it already has for the
// same domains, and leaving everything else as it is.
import type { Array as Arr } from 'effect'

export type CaddySite = {
  // The site's domain, then any domains that redirect to it.
  domains: Arr.NonEmptyReadonlyArray<string>
  // The port the app listens on.
  port: number
}

export type CaddyfileResult = { ok: true; caddyfile: string } | { ok: false; error: string }

export function addSite(caddyfile: string, { domains, port }: CaddySite): CaddyfileResult {
  let [siteDomain, ...redirectDomains] = domains
  let removed = removeSiteBlocks(caddyfile, new Set(domains.map((domain) => domain.toLowerCase())))
  if (!removed.ok) return removed
  let blocks = [
    `${siteDomain} {\n\tencode zstd gzip\n\treverse_proxy 127.0.0.1:${port}\n}\n`,
    ...redirectDomains.map(
      (domain) => `${domain} {\n\tredir https://${siteDomain}{uri} permanent\n}\n`,
    ),
  ]
  let rest = collapseBlankLines(removed.caddyfile)
  return { ok: true, caddyfile: [...(rest ? [rest] : []), ...blocks].join('\n') }
}

// Drops the top-level site blocks whose addresses are all in domains. A block that mixes them with
// other sites is left for editing by hand.
function removeSiteBlocks(caddyfile: string, domains: Set<string>): CaddyfileResult {
  let output: string[] = []
  // The lines of a top-level block's addresses, which may span lines ending with commas, until
  // its { shows whether it's kept.
  let pending: string[] = []
  let addresses = ''
  // How deep in braces the line is, and whether it's in a block being dropped.
  let depth = 0
  let dropping = false

  for (let line of caddyfile.split('\n')) {
    let code = withoutComment(line)
    let change = count(code, '{') - count(code, '}')

    if (dropping || depth > 0) {
      depth = Math.max(depth + change, 0)
      if (dropping) dropping = depth > 0
      else output.push(line)
      continue
    }

    pending.push(line)
    addresses += ` ${code}`
    if (/,\s*$/.test(code)) continue

    if (code.includes('{')) {
      let hosts = addresses
        .replace(/\{.*$/, '')
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(host)
      let matched = hosts.filter((name) => domains.has(name))
      if (matched.length > 0 && matched.length < hosts.length) {
        return {
          ok: false,
          error: `A site block mixes these domains with others, edit it by hand: ${hosts.join(', ')}`,
        }
      }
      depth = Math.max(change, 0)
      if (matched.length > 0) {
        dropping = depth > 0
        pending = []
        addresses = ''
        continue
      }
    }

    output.push(...pending)
    pending = []
    addresses = ''
  }
  output.push(...pending)
  return { ok: true, caddyfile: output.join('\n') }
}

function withoutComment(line: string): string {
  return /^\s*#/.test(line) ? '' : line.replace(/\s#.*$/, '')
}

function count(text: string, char: string): number {
  return text.split(char).length - 1
}

// The host of a site address, like example.com in https://example.com:443/path.
function host(address: string): string {
  return address
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .toLowerCase()
}

// Collapses the runs of blank lines removed blocks leave behind, and drops leading and trailing
// ones.
function collapseBlankLines(text: string): string {
  let lines: string[] = []
  let blank = false
  for (let line of text.split('\n')) {
    if (!line.trim()) {
      blank = true
      continue
    }
    if (blank && lines.length > 0) lines.push('')
    lines.push(line)
    blank = false
  }
  return lines.length > 0 ? `${lines.join('\n')}\n` : ''
}
