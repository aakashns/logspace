// /admin/integrations' email section: saving how the site sends email (its secret sealed),
// removing it, and sending a test email, to the site's own fake of Amazon SES (see
// ../../dev/emails/), or to SES or Resend, which a fake network answers for.
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { Effect, Redacted } from 'effect'
import { SqlClient } from 'effect/sql'

import { capture, defined, makeTestApp } from '../../../../test/app.ts'
import { EMAIL_SECRET_PURPOSES } from '../../../data/site/site.ts'
import { SealedSecret, Secrets } from '../../../lib/secrets.ts'
import { EXAMPLE_AWS_KEY } from '../../dev/emails/handler.tsx'

const SECRET_ACCESS_KEY = 'TestSecretAccessKey/NotARealOne+00000000'
const API_KEY = 're_test_key_abcd1234'
const RESEND = 'https://api.resend.com/emails'
const SES = 'https://email.eu-west-1.amazonaws.com/v2/email/outbound-emails'
// The test app's fake of SES. It listens on no port, so the fake network takes requests for it
// there.
const FAKE_SES = 'http://fake-ses.test'

// What the fake network was asked (but for the fake of SES), and how it answers.
let requests: { url: string; headers: Headers; body: unknown }[] = []
let answer: () => Promise<Response> = () => Promise.reject(new Error('No answer set'))

const app = makeTestApp(
  {},
  {
    network: {
      resolve: () => Promise.reject(new Error('Not expected')),
      fetch: async (url, init) => {
        // With the Host header a request on the wire has, which the fake checks the signature
        // against.
        if (url.origin === FAKE_SES) {
          let headers = new Headers(init.headers)
          headers.set('host', url.host)
          return app.fetch(url.href, { ...init, headers })
        }
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

beforeEach(async () => {
  await app.seedDatabase()
  requests = []
  answer = () => Promise.reject(new Error('No answer set'))
})
afterAll(async () => {
  await app.dispose()
  await otherSecret.dispose()
})

const sql = <A extends object>(
  run: (sql: SqlClient.SqlClient) => Effect.Effect<readonly A[], unknown>,
) => app.run(Effect.flatMap(SqlClient.SqlClient, run).pipe(Effect.orDie))
const savedRow = async () =>
  (await sql((sql) => sql<{ value: string }>`select value from config where key = 'email'`))[0]
    ?.value
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

// SES at the site's fake of it, with the only key it takes.
const EXAMPLE_FORM = {
  provider: 'ses',
  sesRegion: 'us-east-1',
  sesEndpoint: `${FAKE_SES}/dev/ses`,
  sesAccessKeyId: EXAMPLE_AWS_KEY.accessKeyId,
  sesSecretAccessKey: EXAMPLE_AWS_KEY.secretAccessKey,
  fromName: 'Test Site',
  from: 'news@example.com',
  replyTo: 'me@example.com',
}
// SES itself, with a key of its own.
const SES_FORM = {
  ...EXAMPLE_FORM,
  sesRegion: 'eu-west-1',
  sesEndpoint: 'https://email.eu-west-1.amazonaws.com',
  sesAccessKeyId: 'TESTACCESSKEYID00001',
  sesSecretAccessKey: SECRET_ACCESS_KEY,
}
const RESEND_FORM = {
  provider: 'resend',
  resendApiKey: API_KEY,
  fromName: 'Test Site',
  from: 'news@example.com',
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
// The fake of SES's inbox, which keeps every test's emails, and how many it has.
const inbox = async () => (await app.fetch('/dev/emails')).text()
const inboxSize = async () => (await inbox()).split('data-slot="card"').length - 1

describe('email settings', () => {
  it('are only for the admin', async () => {
    for (let path of ['', '/remove', '/test']) {
      let response = await app.fetch(`/admin/integrations/email${path}`, {
        method: 'POST',
        body: new URLSearchParams({ ...SES_FORM, to: 'reader@example.com' }),
      })
      expect(response.status).toBe(302)
    }
    expect(await savedRow()).toBeUndefined()
    expect(requests).toEqual([])
  })

  it('show email as not set up, without a test to send', async () => {
    let html = await page()
    expect(html).toContain('<h2 id="email-heading">Email</h2>')
    expect(html).toContain('Not set up')
    // SES's endpoint in us-east-1, to change.
    expect(html).toContain('name="sesEndpoint" value="https://email.us-east-1.amazonaws.com"')
    expect(html).toContain('action="/admin/integrations/email"')
    expect(html).not.toContain('Send a test email')
    expect(html).not.toContain('formaction="/admin/integrations/email/remove"')
  })

  it('save SES, sealing its secret access key, and show it without it', async () => {
    let response = await save(SES_FORM)
    expect(response.status).toBe(303)
    let row = await saved()
    expect(row).toMatchObject({
      from: 'news@example.com',
      replyTo: 'me@example.com',
      provider: {
        _tag: 'ses',
        region: 'eu-west-1',
        endpoint: 'https://email.eu-west-1.amazonaws.com',
        accessKeyId: 'TESTACCESSKEYID00001',
      },
    })
    expect(JSON.stringify(row)).not.toContain(SECRET_ACCESS_KEY)
    expect(await open(row.provider.secretAccessKey, EMAIL_SECRET_PURPOSES.ses)).toBe(
      SECRET_ACCESS_KEY,
    )

    let html = await (
      await app.fetch('/admin/integrations', {
        headers: { Cookie: defined(app.sessionCookie(response), 'a cookie') },
      })
    ).text()
    expect(status(html)).toContain('Saved. Send a test email below.')
    expect(html).toContain('Set up')
    expect(html).toContain('value="eu-west-1"')
    expect(html).toContain('value="TESTACCESSKEYID00001"')
    expect(html).toContain(`placeholder="••••••••••••${SECRET_ACCESS_KEY.slice(-4)}"`)
    expect(html).not.toContain(SECRET_ACCESS_KEY)
    expect(html).toContain('Send a test email')
  })

  it('keep the saved secret when it’s left empty', async () => {
    await save(SES_FORM)
    let sealed = (await saved()).provider.secretAccessKey
    await save({ ...SES_FORM, sesSecretAccessKey: '', from: 'other@example.com' })
    expect((await saved()).provider.secretAccessKey).toBe(sealed)
    expect((await saved()).from).toBe('other@example.com')
  })

  it('refuse a form with mistakes, showing what was typed but the secret', async () => {
    let response = await save({
      ...SES_FORM,
      sesRegion: 'Ireland',
      sesEndpoint: 'email.eu-west-1.amazonaws.com',
      sesAccessKeyId: 'not a key',
      fromName: 'Two\nlines',
      sesSecretAccessKey: 'short',
      from: 'not an address',
      replyTo: 'me@',
    })
    expect(response.status).toBe(400)
    let html = await response.text()
    let issues = alert(html)
    expect(issues).toContain('Region: Expected an AWS region, like us-east-1')
    expect(issues).toContain('Endpoint: Expected the address of an SES API')
    expect(issues).toContain('From name: Expected a name on one line')
    expect(issues).toContain('Access key ID: Expected an access key ID')
    expect(issues).toContain('Secret access key: Expected the secret access key')
    expect(issues).toContain('From: Expected an email address')
    expect(issues).toContain('Reply-to: Expected an email address')
    expect(html).toContain('value="not an address"')
    expect(html).toContain('value="Ireland"')
    expect(html).not.toContain('value="short"')
    expect(await savedRow()).toBeUndefined()

    let missing = await save({ ...SES_FORM, sesSecretAccessKey: '' })
    expect(alert(await missing.text())).toContain('Secret access key: Enter the secret access key')
    expect(await savedRow()).toBeUndefined()
  })

  it('don’t move a secret to another provider: switching needs its own', async () => {
    await save(SES_FORM)
    let response = await save({ ...RESEND_FORM, resendApiKey: '' })
    expect(response.status).toBe(400)
    expect(alert(await response.text())).toContain('API key: Enter the API key')
    expect((await saved()).provider._tag).toBe('ses')
    expect((await save(RESEND_FORM)).status).toBe(303)
    expect((await saved()).provider._tag).toBe('resend')
  })

  it('are forgotten when removed', async () => {
    await save(SES_FORM)
    let response = await post('/admin/integrations/email/remove', {}, await login())
    expect(response.status).toBe(303)
    expect(await savedRow()).toBeUndefined()
  })

  it('ask for the secret again when AUTH_SESSION_SECRET changed', async () => {
    await save(SES_FORM)
    let row = await saved()
    row.provider.secretAccessKey = await otherSecret.run(
      Effect.flatMap(Secrets, (secrets) =>
        secrets.seal(SECRET_ACCESS_KEY, EMAIL_SECRET_PURPOSES.ses),
      ),
    )
    await sql((sql) => sql`update config set value = ${JSON.stringify(row)} where key = 'email'`)
    let html = await page()
    expect(html).toContain('Needs its secret again')
    expect(html).toContain('The saved secret access key can’t be read')
    expect(html).not.toContain('placeholder="•')

    expect((await sendTest('reader@example.com')).status).toBe(409)
    let resave = await save({ ...SES_FORM, sesSecretAccessKey: '' })
    expect(alert(await resave.text())).toContain(
      'Secret access key: The saved secret access key can’t be read',
    )
    expect(requests).toEqual([])
  })
})

describe('a test email', () => {
  it('goes to the site’s fake of SES with the example key, from the site, with its reply-to', async () => {
    await save(EXAMPLE_FORM)
    let response = await sendTest('reader@example.com')
    expect(response.status).toBe(200)
    let html = await response.text()
    expect(status(html)).toContain('Sent to reader@example.com.')
    expect(html).toContain('value="reader@example.com"')
    expect(requests).toEqual([])

    let received = await inbox()
    expect(received).toContain('Test email from Test Site</h2>')
    expect(received).toContain('<dt>From</dt><dd>"Test Site" &lt;news@example.com&gt;</dd>')
    expect(received).toContain('<dt>To</dt><dd>reader@example.com</dd>')
    expect(received).toContain('<dt>Reply-To</dt><dd>me@example.com</dd>')
    expect(received).toContain('https://example.com')
  })

  it('is from the address alone, without a name or reply-to, when there’s neither', async () => {
    await save({ ...EXAMPLE_FORM, fromName: '', replyTo: '' })
    expect((await sendTest('alone@example.com')).status).toBe(200)
    let latest = (await inbox()).split('data-slot="card"')[1] ?? ''
    expect(latest).toContain('<dt>To</dt><dd>alone@example.com</dd>')
    expect(latest).toContain('<dt>From</dt><dd>news@example.com</dd>')
    expect(latest).not.toContain('Reply-To')
  })

  it('is refused by the fake of SES when the secret access key is wrong', async () => {
    await save({ ...EXAMPLE_FORM, sesSecretAccessKey: SECRET_ACCESS_KEY, replyTo: '' })
    let before = await inboxSize()
    let response = await sendTest('reader@example.com')
    expect(response.status).toBe(502)
    expect(alert(await response.text())).toContain(
      'InvalidSignatureException: The request signature we calculated does not match',
    )
    expect(await inboxSize()).toBe(before)
  })

  it('goes to SES, signed, and reports why SES refused it', async () => {
    // A name that isn't ASCII is encoded, as SES needs.
    await save({ ...SES_FORM, fromName: 'Café', replyTo: '' })
    answer = () =>
      Promise.resolve(
        Response.json(
          { message: 'Email address is not verified.' },
          {
            status: 400,
            headers: { 'x-amzn-ErrorType': 'MessageRejected:http://internal.amazon.com/coral/' },
          },
        ),
      )
    let response = await sendTest('reader@example.com')
    expect(response.status).toBe(502)
    expect(alert(await response.text())).toContain(
      'MessageRejected: Email address is not verified.',
    )
    let [request] = requests
    expect(request?.url).toBe(SES)
    expect(request?.headers.get('content-type')).toBe('application/json')
    expect(request?.headers.get('x-amz-date')).toMatch(/^\d{8}T\d{6}Z$/)
    expect(request?.headers.get('authorization')).toMatch(
      /^AWS4-HMAC-SHA256 Credential=TESTACCESSKEYID00001\/\d{8}\/eu-west-1\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/,
    )
    expect(request?.body).toEqual({
      FromEmailAddress: `=?UTF-8?B?${Buffer.from('Café').toString('base64')}?= <news@example.com>`,
      Destination: { ToAddresses: ['reader@example.com'] },
      Content: {
        Simple: {
          Subject: { Data: 'Test email from Test Site', Charset: 'UTF-8' },
          Body: {
            Text: { Data: expect.stringContaining('https://example.com'), Charset: 'UTF-8' },
          },
        },
      },
    })
  })

  it('needs an address, and settings to send it with', async () => {
    let unset = await sendTest('reader@example.com')
    expect(unset.status).toBe(409)
    expect(alert(await unset.text())).toContain('Email isn’t set up')
    await save(EXAMPLE_FORM)
    let before = await inboxSize()
    for (let to of ['', 'reader', 'a@b\r\nBcc: c@d']) {
      let response = await sendTest(to)
      expect(response.status).toBe(400)
      expect(alert(await response.text())).toContain('Enter an email address to send it to')
    }
    expect(await inboxSize()).toBe(before)
  })

  it('goes to Resend’s API, with the API key it was saved with', async () => {
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
