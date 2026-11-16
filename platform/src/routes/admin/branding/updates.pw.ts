import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from '../../../../browser/fixtures.ts'

test.use({ managedUpdates: true })

test('updates persist preferences, survive dropped requests, and show the restarted version', async ({
  page,
  app,
}, info) => {
  const screenshot = async (name: string) => {
    const path = info.outputPath(`${name}-full-page.png`)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path, fullPage: true })
    await info.attach(name, { path, contentType: 'image/png' })
  }
  const section = page.locator('#software-updates')
  await expect(section).toContainText('99.0.0 is available')
  await section.scrollIntoViewIfNeeded()
  await screenshot('update-available')
  await page.setViewportSize({ width: 390, height: 844 })
  await screenshot('update-available-mobile')
  expect(await page.locator('body').evaluate((body) => body.scrollWidth)).toBeLessThanOrEqual(390)
  await page.setViewportSize({ width: 1100, height: 900 })
  const details = section.locator('details')
  await section.locator('summary').click()
  await page.waitForResponse(
    (response) =>
      response.url().includes('/admin/branding/updates') && response.request().method() === 'GET',
  )
  await expect(details).not.toHaveAttribute('open')
  await section.locator('summary').click()
  await page.getByLabel('Enable automatic updates').check()
  await page.getByRole('button', { name: 'Save update preference' }).click()
  const file = join(app.directory, 'updates.json')
  await expect.poll(async () => JSON.parse(await readFile(file, 'utf8')).enabled).toBe(true)
  await page.reload()
  await expect(page.getByLabel('Enable automatic updates')).toBeChecked()
  // The server accepts the mutation, but the connection dies before the browser receives it.
  let posts = 0
  await page.route('**/admin/branding/updates', async (route) => {
    if (route.request().method() === 'POST') {
      posts++
      await route.fetch()
      await route.abort('connectionreset')
    } else await route.continue()
  })
  await page.getByRole('button', { name: 'Update now', exact: true }).click()
  await expect(section).toContainText('Update requested', { timeout: 12000 })
  await screenshot('update-pending')
  // Simulate the independent privileged job and replacement server completing the upgrade.
  await writeFile(
    file,
    JSON.stringify({
      enabled: true,
      pending: false,
      current: '99.0.0',
      latest: '99.0.0',
      message: 'Updated to LogSpace 99.0.0.',
    }),
  )
  await expect(section).toContainText('You’re on the latest version', { timeout: 12000 })
  await expect(section).toContainText('Running LogSpace 99.0.0')
  await expect(page.getByRole('button', { name: 'Update now', exact: true })).toHaveCount(0)
  expect(posts).toBe(1)
  await screenshot('update-complete')
  await page.goto('/admin/integrations')
  await page
    .locator('summary')
    .filter({ has: page.getByRole('heading', { name: 'Email', exact: true }) })
    .click()
  await screenshot('integrations-reference')
})
