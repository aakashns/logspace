// Turning notifications on from the home page's bell, in Chromium itself, headless, which asks to
// show notifications (its headless shell denies them). Playwright's browsers are private windows,
// which Chrome doesn't give push, so it ends in the error that says so, once the service worker's
// registered, under the site's CSP and Trusted Types.
import { test, expect } from '../../../browser/fixtures.ts'

test.use({ serviceWorkers: 'allow', channel: 'chromium' })
test.skip(
  ({ browserName }) => browserName !== 'chromium',
  'Playwright grants notifications only in Chromium',
)

test('registers the service worker for the whole site, then says why it couldn’t subscribe', async ({
  page,
  context,
  app,
}) => {
  await context.grantPermissions(['notifications'], { origin: app.origin })
  await page.goto('/admin/subscribers')
  await expect(page.locator('html')).not.toHaveAttribute('data-nonce')
  await page.getByRole('switch', { name: 'Enable push notifications' }).click()
  await expect(page.getByRole('switch', { name: 'Enable push notifications' })).toBeChecked()
  await page.goto('/')
  let bell = page.getByRole('button', { name: 'Notify me of new posts' })
  await expect(bell).toHaveAttribute('aria-pressed', 'false')
  await bell.click()
  let dialog = page.getByRole('dialog', { name: 'Couldn’t turn on notifications' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Your browser couldn’t set up notifications')
  await expect(dialog).toContainText('Private windows can’t get them')
  await dialog.getByRole('button', { name: 'OK' }).click()
  await expect(dialog).toBeHidden()
  await expect(bell).toHaveAttribute('aria-pressed', 'false')
  let scope = await page.evaluate(
    async () => (await navigator.serviceWorker.getRegistration())?.scope,
  )
  expect(scope).toBe(`${app.origin}/`)
})
