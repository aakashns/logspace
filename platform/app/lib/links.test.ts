import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { formatLinkText, getFirstLink, splitLinks } from './links.ts'

describe('links', () => {
  it('finds URLs without trailing punctuation', () => {
    assert.deepEqual(splitLinks('See https://remix.run/docs. And (https://x.com/a)!'), [
      'See ',
      { url: 'https://remix.run/docs' },
      '. And (',
      { url: 'https://x.com/a' },
      ')!',
    ])
    assert.equal(getFirstLink('no links here'), undefined)
  })

  it('leaves URLs that don’t parse as plain text', () => {
    let text = 'Broken https://[bad-host] then https://remix.run'
    assert.deepEqual(splitLinks(text), [
      'Broken https://[bad-host] then ',
      { url: 'https://remix.run' },
    ])
    assert.equal(getFirstLink(text), 'https://remix.run')
    assert.equal(getFirstLink('Only https://[bad-host]'), undefined)
  })

  it('shortens how links read', () => {
    assert.equal(formatLinkText('https://www.remix.run/'), 'remix.run')
    assert.equal(formatLinkText(`https://example.com/${'a'.repeat(50)}`).length, 40)
  })
})
