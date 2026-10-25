// Setting up email at /admin/integrations and sending a test email, to a real SMTP server:
// Mailpit (https://mailpit.axllent.org), which catches what it's sent and shows it over its API.
// The tests that need Mailpit are skipped where it isn't installed.
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'

import { test, expect } from '../../../../browser/fixtures.ts'

// A port nothing's listening on.
const freePort = () =>
  new Promise<number>((resolve) => {
    let server = createServer().listen(0, '127.0.0.1', () => {
      let address = server.address()
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0))
    })
  })

const mailpit = test.extend<{ mailpit: { smtp: number; api: string } }>({
  // Playwright requires a destructuring pattern even when this fixture has no dependencies.
  // oxlint-disable-next-line no-empty-pattern
  mailpit: async ({}, use, info) => {
    info.skip(spawnSync('mailpit', ['version']).error !== undefined, 'Mailpit isn’t installed')
    let smtp = await freePort()
    let http = await freePort()
    let child = spawn('mailpit', ['--smtp', `127.0.0.1:${smtp}`, '--listen', `127.0.0.1:${http}`], {
      stdio: 'ignore',
    })
    let api = `http://127.0.0.1:${http}/api/v1`
    await expect
      .poll(() =>
        fetch(`${api}/info`).then(
          (r) => r.status,
          () => 0,
        ),
      )
      .toBe(200)
    try {
      await use({ smtp, api })
    } finally {
      child.kill()
    }
  },
})

mailpit(
  'sends a test email from the site, with its reply-to, to the address typed',
  async ({ page, mailpit }) => {
    await page.goto('/admin/integrations')
    await page.getByText('Email', { exact: true }).click()
    let email = page.locator('details:has(#email-heading)')
    await expect(email.getByText('Not set up')).toBeVisible()

    // Only the chosen provider's fields show.
    await expect(email.getByLabel('Server')).toBeVisible()
    await expect(email.getByLabel('API key')).toBeHidden()
    await email.getByLabel('Send with').selectOption('resend')
    await expect(email.getByLabel('API key')).toBeVisible()
    await expect(email.getByLabel('Server')).toBeHidden()
    await email.getByLabel('Send with').selectOption('smtp')

    await email.getByLabel('Server').fill('127.0.0.1')
    await email.getByLabel('Security').selectOption('none')
    await email.getByLabel('Port').fill(String(mailpit.smtp))
    await email.getByLabel('From').fill('news@example.com')
    await email.getByLabel('Reply-to').fill('me@example.com')
    await email.getByRole('button', { name: 'Save' }).click()
    await expect(email.getByRole('status')).toContainText('Saved. Send a test email below.')
    await expect(email.getByText('Set up', { exact: true })).toBeVisible()

    await email.getByLabel('To', { exact: true }).fill('reader@example.com')
    await email.getByRole('button', { name: 'Send' }).click()
    await expect(email.getByRole('status')).toContainText('Sent to reader@example.com.')

    let { messages } = await (await fetch(`${mailpit.api}/messages`)).json()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      From: { Name: 'Browser Test', Address: 'news@example.com' },
      To: [{ Address: 'reader@example.com' }],
      ReplyTo: [{ Address: 'me@example.com' }],
      Subject: 'Test email from Browser Test',
    })
  },
)

test('reports a server that refuses the connection', async ({ page }) => {
  await page.goto('/admin/integrations')
  await page.getByText('Email', { exact: true }).click()
  let email = page.locator('details:has(#email-heading)')
  await email.getByLabel('Server').fill('127.0.0.1')
  await email.getByLabel('Security').selectOption('none')
  await email.getByLabel('Port').fill(String(await freePort()))
  await email.getByLabel('From').fill('news@example.com')
  await email.getByRole('button', { name: 'Save' }).click()
  await email.getByLabel('To', { exact: true }).fill('reader@example.com')
  await email.getByRole('button', { name: 'Send' }).click()
  await expect(email.getByRole('alert')).toContainText('Not sent.')
  await expect(email.getByRole('alert')).toContainText('ECONNREFUSED')
})
