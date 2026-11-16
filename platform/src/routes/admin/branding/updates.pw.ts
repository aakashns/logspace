import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from '../../../../browser/fixtures.ts'

test.use({ managedUpdates: true })

test('updates persist preferences, survive dropped requests, and show the restarted version', async ({
  page,
  app,
}, info) => {
  const section = page.locator('#software-updates')
  await expect(section).toContainText('99.0.0 is available')
  await section.scrollIntoViewIfNeeded()
  await info.attach('update-available', {
    body: await section.screenshot(),
    contentType: 'image/png',
  })
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
  await info.attach('update-pending', {
    body: await section.screenshot(),
    contentType: 'image/png',
  })
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
  await info.attach('update-complete', {
    body: await section.screenshot(),
    contentType: 'image/png',
  })
})
