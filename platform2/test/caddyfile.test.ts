// Ported from ../platform/binary/caddyfile.test.ts.
import * as assert from 'node:assert/strict'
import { describe, it } from 'bun:test'

import { addSite } from '../src/cli/caddyfile.ts'

const SITE = { domains: ['example.com', 'www.example.com'], port: 44100 }
const BLOCKS = `example.com {
	encode zstd gzip
	reverse_proxy localhost:44100
}

www.example.com {
	redir https://example.com{uri} permanent
}
`

function caddyfile(existing: string, site = SITE) {
  let result = addSite(existing, site)
  assert.ok(result.ok, result.ok ? '' : result.error)
  return result.caddyfile
}

describe('addSite', () => {
  it('adds the site and its redirects to an empty Caddyfile', () => {
    assert.equal(caddyfile(''), BLOCKS)
  })

  it('points the site at the port and adds no redirects without other domains', () => {
    assert.equal(
      caddyfile('', { domains: ['example.com'], port: 8080 }),
      'example.com {\n\tencode zstd gzip\n\treverse_proxy localhost:8080\n}\n',
    )
  })

  it('keeps other sites, global options, snippets, and comments', () => {
    let existing = `# Global options
{
	email me@example.org
}

(common) {
	encode gzip
}

other.org {
	import common
	respond "hi" # a comment with { in it
}
`
    assert.equal(caddyfile(existing), `${existing}\n${BLOCKS}`)
  })

  it('replaces the blocks it added before, and is the same when run again', () => {
    let once = caddyfile('other.org {\n\trespond "hi"\n}\n')
    assert.equal(caddyfile(once), once)
    assert.equal(caddyfile(caddyfile(once, { ...SITE, port: 44105 })), once)
  })

  it('replaces blocks with nested braces and addresses in any form', () => {
    let existing = `https://Example.com:443,
  www.example.com/path {
	handle {
		respond "old"
	}
}

other.org {
	respond "hi"
}

http://www.example.com { respond "one line" }
`
    assert.equal(caddyfile(existing), `other.org {\n\trespond "hi"\n}\n\n${BLOCKS}`)
  })

  it("leaves a block that mixes the site's domains with others for editing by hand", () => {
    let result = addSite('example.com, other.org {\n}\n', SITE)
    assert.ok(!result.ok)
    assert.match(result.error, /example\.com, other\.org/)
  })
})
