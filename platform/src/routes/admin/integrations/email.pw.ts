// The email section of /admin/integrations shows only the chosen provider's fields, without
// JavaScript (with CSS's :has()), and Datastar keeps SES's endpoint in the region typed.
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

test('changes SES’s endpoint to the region typed, but not another address', async ({ page }) => {
  await page.goto('/admin/integrations')
  await page.getByText('Email', { exact: true }).click()
  let email = page.locator('details:has(#email-heading)')
  let region = email.getByLabel('Region')
  let endpoint = email.getByLabel('Endpoint')
  await region.pressSequentially('eu-west-1')
  await expect(endpoint).toHaveValue('https://email.eu-west-1.amazonaws.com')
  await endpoint.fill('http://localhost:4000/dev/ses')
  await region.fill('us-east-2')
  await expect(endpoint).toHaveValue('http://localhost:4000/dev/ses')
})
