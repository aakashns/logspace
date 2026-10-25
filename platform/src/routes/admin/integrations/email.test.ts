// /admin/integrations' email section: saving how the site sends email (its password or API key
// sealed), removing it, and sending a test email, over SMTP to a server the test runs, or to
// Resend, which a fake network answers for.
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { Effect, Redacted } from 'effect'
import { SqlClient } from 'effect/sql'

import { capture, defined, makeTestApp } from '../../../../test/app.ts'
import { startSmtpServer } from '../../../../test/smtp-server.ts'
import { EMAIL_SECRET_PURPOSES } from '../../../data/site/site.ts'
import { SealedSecret, Secrets } from '../../../lib/secrets.ts'

const PASSWORD = 'smtp-password-1234'
const API_KEY = 're_test_key_abcd1234'
const RESEND = 'https://api.resend.com/emails'

// What the fake network was asked, and how it answers.
let requests: { url: string; headers: Headers; body: unknown }[] = []
let answer: () => Promise<Response> = () => Promise.reject(new Error('No answer set'))

const app = makeTestApp(
  {},
  {
    network: {
      resolve: () => Promise.reject(new Error('Not expected')),
      fetch: async (url, init) => {
        requests.push({
          url: url.href,
          headers: new Headers(init.headers),
          body: JSON.parse(await new Response(init.body).text()),
        })
        return answer()
      },
    },
  },
)
// The same database's secrets, as another AUTH_SESSION_SECRET seals them.
const otherSecret = makeTestApp({ sessionSecret: Redacted.make('another-session-secret') })
const smtp = await startSmtpServer()

beforeEach(async () => {
  await app.seedDatabase()
  requests = []
  answer = () => Promise.reject(new Error('No answer set'))
  smtp.received.length = 0
  smtp.refuse({})
})
afterAll(async () => {
  smtp.stop()
  await app.dispose()
  await otherSecret.dispose()
})

const savedRow = async () => {
  let rows = await app.run(
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql<{ value: string }>`select value from config where key = 'email'`,
    ).pipe(Effect.orDie),
  )
  return rows[0]?.value
}
const saved = async () => JSON.parse(defined(await savedRow(), 'saved email settings'))
const open = (sealed: string, purpose: string) =>
  app.run(Effect.flatMap(Secrets, (secrets) => secrets.open(SealedSecret.make(sealed), purpose)))

const login = async () => defined(app.sessionCookie(await app.logIn()), 'a session cookie')
const post = (path: string, fields: Record<string, string>, cookie: string) =>
  app.fetch(path, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: new URLSearchParams(fields),
  })
const page = async () =>
  (await app.fetch('/admin/integrations', { headers: { Cookie: await login() } })).text()

// The fields of an SMTP setup that sends to the test's server.
const SMTP_FORM = {
  provider: 'smtp',
  smtpHost: '127.0.0.1',
  smtpPort: String(smtp.port),
  smtpSecurity: 'none',
  smtpUsername: 'mailer',
  smtpPassword: PASSWORD,
  from: 'news@example.com',
  replyTo: 'me@example.com',
}
const RESEND_FORM = {
  provider: 'resend',
  resendApiKey: API_KEY,
  from: 'news@example.com',
  replyTo: '',
}
const save = async (fields: Record<string, string>) =>
  post('/admin/integrations/email', fields, await login())
const sendTest = async (to: string) => post('/admin/integrations/email/test', { to }, await login())
const alert = (html: string) =>
  capture(
    html,
    /<div data-slot="alert" data-variant="destructive" role="alert">([^]*?)<\/div><\/div>/,
  )
// The section's success message.
const status = (html: string) => capture(html, /<div[^>]*role="status"[^>]*>([^]*?)<\/div>/)

describe('email settings', () => {
  it('are only for the admin', async () => {
    for (let path of ['', '/remove', '/test']) {
      let response = await app.fetch(`/admin/integrations/email${path}`, {
        method: 'POST',
        body: new URLSearchParams({ ...SMTP_FORM, to: 'reader@example.com' }),
      })
      expect(response.status).toBe(302)
    }
    expect(await savedRow()).toBeUndefined()
    expect(smtp.received).toEqual([])
  })

  it('show email as not set up, without a test to send', async () => {
    let html = await page()
    expect(html).toContain('<h2 id="email-heading">Email</h2>')
    expect(html).toContain('Not set up')
    expect(html).toContain('action="/admin/integrations/email"')
    expect(html).not.toContain('Send a test email')
    expect(html).not.toContain('formaction="/admin/integrations/email/remove"')
  })

  it('save an SMTP server, sealing its password, and show it without the password', async () => {
    let response = await save({ ...SMTP_FORM, smtpPort: '', smtpSecurity: 'starttls' })
    expect(response.status).toBe(303)
    let row = await saved()
    expect(row).toMatchObject({
      from: 'news@example.com',
      replyTo: 'me@example.com',
      provider: { _tag: 'smtp', host: '127.0.0.1', port: 587, security: 'starttls' },
    })
    expect(JSON.stringify(row)).not.toContain(PASSWORD)
    expect(await open(row.provider.password, EMAIL_SECRET_PURPOSES.smtp)).toBe(PASSWORD)

    let html = await (
      await app.fetch('/admin/integrations', {
        headers: { Cookie: defined(app.sessionCookie(response), 'a cookie') },
      })
    ).text()
    expect(status(html)).toContain('Saved. Send a test email below.')
    expect(html).toContain('Set up')
    expect(html).toContain('value="587"')
    expect(html).toContain('<option value="starttls" selected>')
    expect(html).toContain(`placeholder="••••••••••••${PASSWORD.slice(-4)}"`)
    expect(html).not.toContain(PASSWORD)
    expect(html).toContain('Send a test email')
  })

  it('keep the saved password when it’s left empty, and drop it with the username', async () => {
    await save(SMTP_FORM)
    let sealed = (await saved()).provider.password
    await save({ ...SMTP_FORM, smtpPassword: '', from: 'other@example.com' })
    expect((await saved()).provider.password).toBe(sealed)
    expect((await saved()).from).toBe('other@example.com')
    await save({ ...SMTP_FORM, smtpUsername: '', smtpPassword: '' })
    expect((await saved()).provider).not.toHaveProperty('password')
  })

  it('refuse a form with mistakes, showing what was typed but the password', async () => {
    let response = await save({
      ...SMTP_FORM,
      smtpHost: '',
      smtpPort: '70000',
      from: 'not an address',
      replyTo: 'me@',
    })
    expect(response.status).toBe(400)
    let html = await response.text()
    let issues = alert(html)
    expect(issues).toContain('Server: Enter the server’s address')
    expect(issues).toContain('Port: Expected a port, from 1 to 65535')
    expect(issues).toContain('From: Expected an email address')
    expect(issues).toContain('Reply-to: Expected an email address')
    expect(html).toContain('value="not an address"')
    expect(html).toContain('value="70000"')
    expect(html).not.toContain(PASSWORD)
    expect(await savedRow()).toBeUndefined()

    let missing = await save({ ...SMTP_FORM, smtpPassword: '' })
    expect(alert(await missing.text())).toContain('Password: Enter the password')
    let orphan = await save({ ...SMTP_FORM, smtpUsername: '' })
    expect(alert(await orphan.text())).toContain('Username: Enter the username for the password')
    expect(await savedRow()).toBeUndefined()
  })

  it('don’t move a password to Resend: switching needs an API key', async () => {
    await save(SMTP_FORM)
    let response = await save({ ...RESEND_FORM, resendApiKey: '' })
    expect(response.status).toBe(400)
    expect(alert(await response.text())).toContain('API key: Enter the API key')
    let bad = await save({ ...RESEND_FORM, resendApiKey: 'not-a-key' })
    expect(alert(await bad.text())).toContain('which starts with “re_”')
    expect((await saved()).provider._tag).toBe('smtp')
  })

  it('are forgotten when removed', async () => {
    await save(SMTP_FORM)
    let response = await post('/admin/integrations/email/remove', {}, await login())
    expect(response.status).toBe(303)
    expect(await savedRow()).toBeUndefined()
  })

  it('ask for the password again when AUTH_SESSION_SECRET changed', async () => {
    await save(SMTP_FORM)
    let row = await saved()
    row.provider.password = await otherSecret.run(
      Effect.flatMap(Secrets, (secrets) => secrets.seal(PASSWORD, EMAIL_SECRET_PURPOSES.smtp)),
    )
    await app.run(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql`update config set value = ${JSON.stringify(row)} where key = 'email'`,
      ).pipe(Effect.orDie),
    )
    let html = await page()
    expect(html).toContain('Needs its password or API key again')
    expect(html).toContain('The saved password can’t be read')
    expect(html).not.toContain('placeholder="•')

    let test = await sendTest('reader@example.com')
    expect(test.status).toBe(409)
    let resave = await save({ ...SMTP_FORM, smtpPassword: '' })
    expect(alert(await resave.text())).toContain('Password: The saved password can’t be read')
    expect((await save(SMTP_FORM)).status).toBe(303)
    expect(await open((await saved()).provider.password, EMAIL_SECRET_PURPOSES.smtp)).toBe(PASSWORD)
    expect(smtp.received).toEqual([])
  })
})

describe('a test email', () => {
  it('is sent over SMTP from the site, with its reply-to, to the address typed', async () => {
    await save(SMTP_FORM)
    let response = await sendTest('reader@example.com')
    expect(response.status).toBe(200)
    let html = await response.text()
    expect(status(html)).toContain('Sent to reader@example.com.')
    expect(html).toContain('value="reader@example.com"')

    expect(smtp.received).toHaveLength(1)
    let [email] = smtp.received
    expect(email?.login).toBe('mailer')
    expect(email?.from).toBe('news@example.com')
    expect(email?.to).toEqual(['reader@example.com'])
    expect(email?.data).toContain('From: Test Site <news@example.com>')
    expect(email?.data).toContain('Reply-To: me@example.com')
    expect(email?.data).toContain('To: reader@example.com')
    expect(email?.data).toContain('Subject: Test email from Test Site')
    expect(email?.data).toContain('https://example.com')
  })

  it('is sent without a login or a reply-to when there’s neither', async () => {
    await save({ ...SMTP_FORM, smtpUsername: '', smtpPassword: '', replyTo: '' })
    expect((await sendTest('reader@example.com')).status).toBe(200)
    expect(smtp.received[0]?.login).toBeUndefined()
    expect(smtp.received[0]?.data).not.toContain('Reply-To')
  })

  it('reports what the SMTP server said when it refuses one', async () => {
    await save(SMTP_FORM)
    smtp.refuse({ MAIL: '550 5.7.1 Sender address rejected: not owned by user' })
    let response = await sendTest('reader@example.com')
    expect(response.status).toBe(502)
    expect(alert(await response.text())).toContain('Sender address rejected: not owned by user')

    smtp.refuse({ AUTH: '535 5.7.8 Authentication credentials invalid' })
    let login = await sendTest('reader@example.com')
    expect(alert(await login.text())).toContain('Authentication credentials invalid')
    expect(smtp.received).toEqual([])
  })

  it('reports a server that can’t be reached', async () => {
    let gone = await startSmtpServer()
    gone.stop()
    await save({ ...SMTP_FORM, smtpPort: String(gone.port) })
    let response = await sendTest('reader@example.com')
    expect(response.status).toBe(502)
    expect(alert(await response.text())).toContain('ECONNREFUSED')
  })

  it('needs an address, and settings to send it with', async () => {
    let unset = await sendTest('reader@example.com')
    expect(unset.status).toBe(409)
    expect(alert(await unset.text())).toContain('Email isn’t set up')
    await save(SMTP_FORM)
    for (let to of ['', 'reader', 'a@b\r\nBcc: c@d']) {
      let response = await sendTest(to)
      expect(response.status).toBe(400)
      expect(alert(await response.text())).toContain('Enter an email address to send it to')
    }
    expect(smtp.received).toEqual([])
  })

  it('is sent with Resend’s API, with the API key it was saved with', async () => {
    await save({ ...RESEND_FORM, replyTo: 'me@example.com' })
    expect(JSON.stringify(await saved())).not.toContain(API_KEY)
    answer = () => Promise.resolve(Response.json({ id: 'email-id' }))
    let response = await sendTest('reader@example.com')
    expect(response.status).toBe(200)
    expect(requests).toHaveLength(1)
    let [request] = requests
    expect(request?.url).toBe(RESEND)
    expect(request?.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request?.body).toMatchObject({
      from: '"Test Site" <news@example.com>',
      to: ['reader@example.com'],
      reply_to: 'me@example.com',
      subject: 'Test email from Test Site',
    })
    expect(smtp.received).toEqual([])
  })

  it('reports why Resend refused it, or that it couldn’t be reached', async () => {
    await save(RESEND_FORM)
    answer = () =>
      Promise.resolve(
        Response.json(
          { statusCode: 403, name: 'validation_error', message: 'The domain is not verified.' },
          { status: 403 },
        ),
      )
    let refused = await sendTest('reader@example.com')
    expect(refused.status).toBe(502)
    expect(alert(await refused.text())).toContain('The domain is not verified.')

    answer = () => Promise.reject(new Error('offline'))
    let offline = await sendTest('reader@example.com')
    expect(alert(await offline.text())).toContain('Couldn’t reach Resend')
  })
})
