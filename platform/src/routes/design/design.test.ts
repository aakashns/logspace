// /design: the components in components/ui, outside production only.
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'

import { makeTestApp } from '../../../test/app.ts'

const app = makeTestApp()
const production = makeTestApp({ mode: 'production' })

beforeEach(async () => {
  await app.seedDatabase()
  await production.seedDatabase()
})
afterAll(async () => {
  await app.dispose()
  await production.dispose()
})

describe('/design', () => {
  it('shows every component in both themes', async () => {
    let response = await app.fetch('/design')
    let html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toContain('<meta name="robots" content="noindex">')
    for (let scheme of ['light', 'dark']) {
      expect(html).toContain(`class="design-panel" data-scheme="${scheme}"`)
    }
    for (let slot of [
      'button',
      'badge',
      'input',
      'textarea',
      'native-select',
      'field',
      'checkbox',
      'switch',
      'card',
      'dropdown-menu-content',
      'dialog-content',
      'alert',
      'kbd',
      'separator',
    ]) {
      expect(html).toContain(`data-slot="${slot}"`)
    }
  })

  it('wires each menu to its trigger, for screen readers and positioning', async () => {
    let html = await (await app.fetch('/design')).text()
    expect(html).toContain(
      '<button type="button" data-slot="button" data-variant="outline" data-size="default" id="light-menu-trigger" popovertarget="light-menu" aria-haspopup="menu" aria-controls="light-menu" style="anchor-name: --light-menu">',
    )
    expect(html).toMatch(
      /<div id="light-menu" popover role="menu" tabindex="-1" aria-labelledby="light-menu-trigger" data-slot="dropdown-menu-content" style="position-anchor: --light-menu"/,
    )
    // A checkbox item starts as the server rendered it, then follows its signal.
    expect(html).toContain(
      'role="menuitemcheckbox" tabindex="-1" aria-checked="true" data-slot="dropdown-menu-checkbox-item" data-attr:aria-checked="$light.statusBar ? &#39;true&#39; : &#39;false&#39;"'.replaceAll(
        '&#39;',
        "'",
      ),
    )
  })

  it('isn’t served in production', async () => {
    let response = await production.fetch('/design')
    expect(response.status).toBe(404)
  })
})
