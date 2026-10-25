// The email section of /admin/integrations shows only the chosen provider's fields, without
// JavaScript (with CSS's :has()).
import { test, expect } from '../../../../browser/fixtures.ts'

test('shows only the chosen provider’s fields', async ({ page }) => {
  await page.goto('/admin/integrations')
  await page.getByText('Email', { exact: true }).click()
  let email = page.locator('details:has(#email-heading)')
  let ses = [
    email.getByLabel('Region'),
    email.getByLabel('Endpoint'),
    email.getByLabel('Access key ID'),
  ]
  for (let field of ses) await expect(field).toBeVisible()
  await expect(email.getByLabel('API key', { exact: true })).toBeHidden()
  await email.getByLabel('Send with').selectOption('resend')
  await expect(email.getByLabel('API key', { exact: true })).toBeVisible()
  for (let field of ses) await expect(field).toBeHidden()
  // The from name and addresses are for both.
  for (let label of ['From name', 'From', 'Reply-to']) {
    await expect(email.getByLabel(label, { exact: true })).toBeVisible()
  }
})
