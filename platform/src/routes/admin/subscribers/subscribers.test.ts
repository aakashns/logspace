// /admin/subscribers: the switch for subscribing, which goes on only once email is set up and
// Turnstile enabled, and is paused, not switched off, while either goes away.
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { Effect } from 'effect'

import { defined, makeTestApp } from '../../../../test/app.ts'
import { SiteConfigCommands } from '../../../data/site/commands.ts'

const app = makeTestApp()

const commands = <A, E>(run: (commands: SiteConfigCommands['Service']) => Effect.Effect<A, E>) =>
  app.run(Effect.flatMap(SiteConfigCommands, run))
const setUpEmail = () =>
  commands((commands) =>
    commands.saveEmail({
      provider: 'resend',
      fromName: '',
      from: 'news@example.com',
      replyTo: '',
      hourlyLimit: '1000',
      sesRegion: '',
      sesEndpoint: '',
      sesAccessKeyId: '',
      sesSecretAccessKey: '',
      resendApiKey: 're_test_key_abcd1234',
    }),
  )
const setUpTurnstile = (enabled: boolean) =>
  commands((commands) =>
    commands.saveTurnstile(
      { siteKey: '0x4AAAAAAAsiteKey123', secretKey: '0x4AAAAAAAsecretKey456789' },
      enabled,
    ),
  )

let cookie = ''
beforeEach(async () => {
  await app.seedDatabase()
  cookie = defined(app.sessionCookie(await app.logIn()), 'a session cookie')
})
afterAll(app.dispose)

const page = async () => {
  let response = await app.fetch('/admin/subscribers', { headers: { Cookie: cookie } })
  expect(response.status).toBe(200)
  return response.text()
}
const save = (enabled: boolean) =>
  app.fetch('/admin/subscribers', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: new URLSearchParams(enabled ? { enabled: 'on' } : {}),
  })
// The switch's <input>.
const theSwitch = (html: string) =>
  defined(/<input type="checkbox" role="switch"[^>]*>/.exec(html)?.[0], 'the switch')
const home = async () => (await app.fetch('/')).text()

describe('/admin/subscribers', () => {
  it('is only for the admin', async () => {
    let response = await app.fetch('/admin/subscribers', { method: 'POST' })
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('/admin/login')
  })

  it('has a switch that saves when changed, with a title and description', async () => {
    let html = await page()
    expect(html).toContain(
      '<label data-slot="field-label" for="subscriptions-enabled">Enable subscriptions</label>',
    )
    expect(theSwitch(html)).toContain('data-on:change="el.form.requestSubmit()"')
    expect(html).toContain('<noscript>')
  })

  it('can’t be switched on until email is set up and Turnstile enabled, and says why', async () => {
    let html = await page()
    expect(theSwitch(html)).toContain(' disabled')
    expect(html).toContain('Subscriptions need email set up and Cloudflare Turnstile enabled.')
    expect(html).toContain('<li>Email isn’t set up.</li>')
    expect(html).toContain('<li>Cloudflare Turnstile isn’t set up.</li>')

    await setUpEmail()
    await setUpTurnstile(false)
    let refused = await save(true)
    expect(refused.status).toBe(409)
    let refusedHtml = await refused.text()
    expect(refusedHtml).not.toContain('<li>Email isn’t set up.</li>')
    expect(refusedHtml).toContain('<li>Cloudflare Turnstile isn’t enabled.</li>')
    expect(theSwitch(await page())).not.toContain(' checked')
  })

  it('switches on and off, showing the home page’s Subscribe button while it’s on', async () => {
    await setUpEmail()
    await setUpTurnstile(true)
    let html = await page()
    expect(theSwitch(html)).not.toContain(' disabled')
    expect(html).not.toContain('data-slot="alert"')

    let saved = await save(true)
    expect(saved.status).toBe(303)
    expect(saved.headers.get('Location')).toBe('/admin/subscribers')
    expect(theSwitch(await page())).toContain(' checked')
    expect(await home()).toContain('href="/subscribe"')

    expect((await save(false)).status).toBe(303)
    expect(theSwitch(await page())).not.toContain(' checked')
    expect(await home()).not.toContain('href="/subscribe"')
  })

  it('pauses, still on, while Turnstile is off or email is removed, and says why', async () => {
    await setUpEmail()
    await setUpTurnstile(true)
    await save(true)
    await setUpTurnstile(false)
    await commands((commands) => commands.removeIntegration('email'))

    let html = await page()
    expect(theSwitch(html)).toContain(' checked')
    expect(theSwitch(html)).not.toContain(' disabled')
    expect(html).toContain(
      'Subscribing is paused, and the home page doesn’t show the Subscribe button.',
    )
    expect(html).toContain('<li>Email isn’t set up.</li>')
    expect(html).toContain('<li>Cloudflare Turnstile isn’t enabled.</li>')
    expect(html).toContain('<a href="/admin/integrations">Integrations</a>')
    expect(await home()).not.toContain('href="/subscribe"')

    await setUpEmail()
    await setUpTurnstile(true)
    expect(await page()).not.toContain('paused')
    expect(await home()).toContain('href="/subscribe"')
  })
})
