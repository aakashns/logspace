// The home page's bell, in real browsers, with the site's CSP and Trusted Types: switched on at
// /admin/subscribers, it registers the service worker and subscribes where push works, says how
// to allow notifications a browser blocks, shows iPhones how to add the site to the Home Screen,
// and isn't there where push can't work. Subscribing is in subscribe.pw.ts, which runs in
// Chromium itself rather than its headless shell.
import { test, expect } from '../../../browser/fixtures.ts'
import type { Page } from '@playwright/test'

test.use({ serviceWorkers: 'allow' })

async function switchOn(page: Page) {
  await page.goto('/admin/subscribers')
  await expect(page.locator('html')).not.toHaveAttribute('data-nonce')
  await page.getByRole('switch', { name: 'Enable push notifications' }).click()
  await expect(page.getByRole('switch', { name: 'Enable push notifications' })).toBeChecked()
}

const bell = (page: Page) => page.getByRole('button', { name: 'Notify me of new posts' })

test('says how to allow notifications the browser blocks', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Playwright denies notifications only in Chromium')
  await switchOn(page)
  await page.goto('/')
  await bell(page).click()
  let dialog = page.getByRole('dialog', { name: 'Notifications are blocked' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Allow them in its settings for this site')
  await dialog.getByRole('button', { name: 'OK' }).click()
  await expect(page.locator('#push-notifications')).toHaveAttribute('data-state', 'blocked')
})

test.describe('on an iPhone, until the site’s on the Home Screen', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  })

  test('shows how to add it there', async ({ page }) => {
    // Safari has no push outside a site added to the Home Screen.
    await page.addInitScript(() => {
      Reflect.deleteProperty(window, 'PushManager')
    })
    await switchOn(page)
    await page.goto('/')
    await bell(page).click()
    let dialog = page.getByRole('dialog', { name: 'Add this site to your Home Screen' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Add to Home Screen')
    await expect(dialog).toContainText('Open Browser Test from your Home Screen')
    await dialog.getByRole('button', { name: 'Got it' }).click()
    await expect(dialog).toBeHidden()
  })
})

test('isn’t there where push can’t work', async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'PushManager')
  })
  await switchOn(page)
  await page.goto('/')
  await expect(page.locator('#push-notifications')).toBeHidden()
  // Nor is the row it'd be in, with subscribing closed.
  await expect(page.locator('.intro-actions')).toBeHidden()
})
