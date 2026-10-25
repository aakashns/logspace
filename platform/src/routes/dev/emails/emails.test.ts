// The site's fake of Amazon SES: it takes an email signed with AWS's example key, as SES's
// SendEmail does, refuses one SES would, with SES's errors, and shows what it took at /dev/emails.
import { afterAll, describe, expect, it } from 'bun:test'

import { makeTestApp } from '../../../../test/app.ts'
import { EXAMPLE_AWS_KEY, sesUrl, signAwsRequest } from '../../../data/site/email.ts'

const app = makeTestApp()
afterAll(() => app.dispose())

const EMAIL = {
  FromEmailAddress: '"Test Site" <news@example.com>',
  Destination: { ToAddresses: ['reader@example.com'] },
  ReplyToAddresses: ['me@example.com'],
  Content: {
    Simple: {
      Subject: { Data: 'Hello <there>' },
      Body: { Text: { Data: 'First line\nsecond line' } },
    },
  },
}

// A SendEmail request, signed as the Email service signs one, then changed by `change`.
const send = (
  options: {
    body?: string
    key?: typeof EXAMPLE_AWS_KEY
    now?: Date
    change?: (headers: Record<string, string>) => Record<string, string>
  } = {},
) => {
  let body = options.body ?? JSON.stringify(EMAIL)
  let headers = signAwsRequest({
    method: 'POST',
    url: sesUrl('us-east-1'),
    headers: { 'content-type': 'application/json' },
    body,
    region: 'us-east-1',
    service: 'ses',
    ...(options.key ?? EXAMPLE_AWS_KEY),
    now: options.now ?? new Date(),
  })
  return app.fetch('/dev/ses/v2/email/outbound-emails', {
    method: 'POST',
    headers: options.change ? options.change(headers) : headers,
    body,
  })
}
const refusal = async (response: Response) => ({
  status: response.status,
  kind: response.headers.get('x-amzn-errortype'),
  message: (await response.json()).message,
})
const inbox = async () => (await app.fetch('/dev/emails')).text()
const inboxSize = async () => (await inbox()).split('data-slot="card"').length - 1

describe('the fake of SES', () => {
  it('takes an email signed with the example key, and shows it at /dev/emails', async () => {
    let response = await send()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ MessageId: expect.stringMatching(/^[0-9a-f-]{36}$/) })
    let html = await inbox()
    expect(html).toContain('<meta name="robots" content="noindex">')
    // Escaped, and out of Datastar's reach.
    expect(html).toContain('<ol class="dev-emails-list" data-ignore>')
    expect(html).toContain('Hello &lt;there&gt;</h2>')
    expect(html).toContain('<dt>From</dt><dd>"Test Site" &lt;news@example.com&gt;</dd>')
    expect(html).toContain('<dt>To</dt><dd>reader@example.com</dd>')
    expect(html).toContain('<dt>Reply-To</dt><dd>me@example.com</dd>')
    expect(html).toContain('First line\nsecond line</pre>')
  })

  it('refuses a request SES would, as SES does', async () => {
    let before = await inboxSize()
    expect(await refusal(await send({ change: () => ({}) }))).toEqual({
      status: 403,
      kind: 'MissingAuthenticationTokenException',
      message: 'Missing Authentication Token',
    })
    let otherKey = { accessKeyId: 'TESTACCESSKEYID00001', secretAccessKey: 'x'.repeat(40) }
    expect(await refusal(await send({ key: otherKey }))).toMatchObject({
      status: 403,
      kind: 'UnrecognizedClientException',
    })
    let wrongSecret = { ...EXAMPLE_AWS_KEY, secretAccessKey: 'x'.repeat(40) }
    expect(await refusal(await send({ key: wrongSecret }))).toMatchObject({
      status: 403,
      kind: 'InvalidSignatureException',
      message: expect.stringContaining('does not match the signature you provided'),
    })
    // A signed header changed after signing.
    let changed = await send({
      change: (headers) => ({ ...headers, 'content-type': 'text/plain' }),
    })
    expect(await refusal(changed)).toMatchObject({ kind: 'InvalidSignatureException' })
    let old = await send({ now: new Date(Date.now() - 10 * 60 * 1000) })
    expect(await refusal(old)).toMatchObject({
      status: 403,
      kind: 'InvalidSignatureException',
      message: 'Signature expired or not yet valid.',
    })
    let notAnEmail = await send({ body: JSON.stringify({ FromEmailAddress: 'a@example.com' }) })
    expect(await refusal(notAnEmail)).toMatchObject({ status: 400, kind: 'BadRequestException' })
    expect(await inboxSize()).toBe(before)
  })
})
