// The switch on /admin/subscribers saves as it's changed, with Datastar, and the home page's
// Subscribe button follows it. Email goes to the site's fake of SES, and Turnstile's keys are
// saved without the browser loading its widget (the fixture allows no request elsewhere).
import { test, expect } from '../../../../browser/fixtures.ts'

// AWS's example access key, which the fake of SES takes (see ../../dev/emails/handler.tsx, which
// Playwright can't import).
const EXAMPLE_AWS_KEY = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
}

test('switching subscriptions on and off saves it, once email and Turnstile are set up', async ({
  page,
  app,
}) => {
  await page.goto('/admin/subscribers')
  let toggle = page.getByRole('switch', { name: 'Enable subscriptions' })
  await expect(toggle).toBeDisabled()
  await expect(page.getByText('Email isn’t set up.')).toBeVisible()

  let form = (fields: Record<string, string>) => ({ form: fields })
  await page.request.post(
    '/admin/integrations/email',
    form({
      provider: 'ses',
      from: 'news@example.com',
      hourlyLimit: '1000',
      sesRegion: 'us-east-1',
      sesEndpoint: `${app.origin}/dev/ses`,
      sesAccessKeyId: EXAMPLE_AWS_KEY.accessKeyId,
      sesSecretAccessKey: EXAMPLE_AWS_KEY.secretAccessKey,
    }),
  )
  await page.request.post(
    '/admin/integrations/turnstile',
    form({
      siteKey: '1x00000000000000000000AA',
      secretKey: '1x0000000000000000000000000000000AA',
      enabled: 'on',
    }),
  )

  await page.goto('/admin/subscribers')
  await expect(page.locator('html')).not.toHaveAttribute('data-nonce')
  await expect(toggle).toBeEnabled()
  await expect(toggle).not.toBeChecked()
  await toggle.click()
  await expect(page).toHaveURL(`${app.origin}/admin/subscribers`)
  await page.reload()
  await expect(toggle).toBeChecked()
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Subscribe', exact: true })).toHaveAttribute(
    'href',
    '/subscribe',
  )

  await page.goto('/admin/subscribers')
  await expect(page.locator('html')).not.toHaveAttribute('data-nonce')
  await toggle.click()
  await page.reload()
  await expect(toggle).not.toBeChecked()
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Subscribe', exact: true })).toHaveCount(0)
})
