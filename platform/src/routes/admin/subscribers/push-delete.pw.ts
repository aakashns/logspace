// Deleting a browser that gets push notifications from /admin/subscribers, as a subscriber is
// deleted: its row's menu has Delete, which opens a dialog to confirm it.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

import { test, expect } from '../../../../browser/fixtures.ts'

test('a browser is deleted from its menu, once it’s confirmed', async ({ page, app }) => {
  // Playwright runs in Node, without the app's database layer, so the browser goes in directly.
  let db = new DatabaseSync(join(app.directory, 'app.sqlite'))
  db.prepare(
    `insert into push_subscriptions
      (id, endpoint, p256dh, auth, application_server_key, created_at, last_sent_at, last_error, failures)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'stuck-id',
    'https://fcm.googleapis.com/fcm/send/stuck',
    'p256dh',
    'auth',
    'key',
    '2026-10-20T10:00:00.000Z',
    '2026-10-26T10:00:00.000Z',
    'Google’s push service answered 503.',
    3,
  )
  db.close()

  await page.goto('/admin/subscribers')
  await expect(page.locator('html')).not.toHaveAttribute('data-nonce')
  let row = page.getByRole('row', { name: /Google \(Chrome\)/ })
  await expect(row).toContainText('3 in a row. Google’s push service answered 503.')
  let actions = page.getByRole('button', { name: /^Actions for the Google \(Chrome\) browser/ })

  await actions.click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  let dialog = page.getByRole('dialog', { name: 'Delete this browser?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
  await expect(row).toBeVisible()

  await actions.click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await dialog.getByRole('button', { name: 'Delete' }).click()
  await expect(page).toHaveURL(`${app.origin}/admin/subscribers`)
  await expect(page.getByText('No browsers get notifications yet.')).toBeVisible()
})
