import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { captionText, renderCaption } from './caption.ts'

describe('caption', () => {
  it('renders Markdown and keeps line breaks', () => {
    assert.equal(
      renderCaption('**Hi** _there_\nnext line\n\n1. one\n2. two'),
      '<p><strong>Hi</strong> <em>there</em><br>next line</p>\n<ol>\n<li>one</li>\n<li>two</li>\n</ol>',
    )
  })

  it('turns URLs into shortened links that open in a new tab', () => {
    assert.equal(
      renderCaption('See https://www.remix.run/docs. Or [the blog](https://remix.run/blog)'),
      '<p>See <a target="_blank" rel="noopener" href="https://www.remix.run/docs">remix.run/docs</a>.' +
        ' Or <a target="_blank" rel="noopener" href="https://remix.run/blog">the blog</a></p>',
    )
  })

  it('escapes HTML', () => {
    assert.equal(renderCaption('<script>x</script>'), '<p>&lt;script&gt;x&lt;/script&gt;</p>')
  })

  it('strips Markdown for plain text', () => {
    assert.equal(
      captionText('**Title**\n\nSome _text_ and [a link](https://remix.run)\n\n- a\n- b'),
      'Title\nSome text and a link\na\nb',
    )
  })
})
