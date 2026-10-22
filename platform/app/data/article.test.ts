import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { renderArticle } from './article.ts'

describe('renderArticle', () => {
  it('points relative links and images into the post folder', () => {
    let html = renderArticle('p', '[doc](notes.pdf) [site](https://example.com) [about](/about)')
    assert.match(html, /<a data-rmx-document href="\/posts\/p\/notes\.pdf"/)
    assert.match(html, /<a href="https:\/\/example\.com"/)
    assert.match(html, /<a href="\/about"/)
  })

  it('lazy-loads standalone images', () => {
    assert.match(
      renderArticle('p', '![A desk](desk.jpg)'),
      /<img src="\/posts\/p\/desk\.jpg" alt="A desk" loading="lazy"/,
    )
  })

  it('turns standalone videos into players, with a matching poster image', () => {
    let html = renderArticle('p', '![A clip](clip.mp4)', ['clip.mp4', 'clip.jpg'])
    assert.match(html, /<video src="\/posts\/p\/clip\.mp4" poster="\/posts\/p\/clip\.jpg"/)
    assert.doesNotMatch(renderArticle('p', '![A clip](clip.mp4)', ['clip.mp4']), /poster=/)
  })

  it('escapes raw HTML', () => {
    let html = renderArticle('p', 'Hi <script>alert(1)</script>\n\n<iframe src="x"></iframe>')
    assert.doesNotMatch(html, /<script|<iframe/)
  })
})
