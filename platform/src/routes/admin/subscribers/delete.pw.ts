// Deleting a subscriber from /admin/subscribers: their row's menu (a popover) has Delete, which
// opens a dialog to confirm it (with command/commandfor) as the menu closes.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

import { test, expect } from '../../../../browser/fixtures.ts'

test('a subscriber is deleted from their menu, once it’s confirmed', async ({ page, app }) => {
  // Playwright runs in Node, without the app's database layer, so the account goes in directly.
  let db = new DatabaseSync(join(app.directory, 'app.sqlite'))
  let now = new Date().toISOString()
  db.prepare(
    `insert into users (id, name, email, email_verified, created_at, updated_at)
      values (?, ?, ?, 1, ?, ?)`,
  ).run('ada-id', 'Ada Lovelace', 'ada@example.com', now, now)
  db.close()

  await page.goto('/admin/subscribers')
  await expect(page.locator('html')).not.toHaveAttribute('data-nonce')
  let row = page.getByRole('row', { name: /ada@example\.com/ })
  await expect(row).toContainText('Ada Lovelace')

  await page.getByRole('button', { name: 'Actions for ada@example.com' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(page.getByRole('menu')).toBeHidden()
  let dialog = page.getByRole('dialog', { name: 'Delete this subscriber?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
  await expect(row).toBeVisible()

  await page.getByRole('button', { name: 'Actions for ada@example.com' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await dialog.getByRole('button', { name: 'Delete' }).click()
  await expect(page).toHaveURL(`${app.origin}/admin/subscribers`)
  await expect(page.getByText('No subscribers yet.')).toBeVisible()
})
