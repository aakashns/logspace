// Email, set up at /admin/integrations: whether it's set up, and sending a message, with Amazon
// SES's API or Resend's, over HTTPS. SES's requests are signed with AWS Signature Version 4.
// https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html
// https://resend.com/docs/api-reference/emails/send-email
import { createHash, createHmac } from 'node:crypto'
import { Context, DateTime, Duration, Effect, Layer, Schema } from 'effect'
import { HttpClient, HttpClientRequest } from 'effect/http'

import { Secrets, SecretUnreadable } from '../../lib/secrets.ts'
import { SiteConfigQueries } from './queries.ts'
import {
  EMAIL_SECRET_PURPOSES,
  type EmailProvider,
  type EmailSettings,
  isEmailAddress,
  type SesProvider,
} from './site.ts'

const RESEND_URL = 'https://api.resend.com/emails'
const TIMEOUT = Duration.seconds(30)
const PROVIDER_NAMES = { ses: 'Amazon SES', resend: 'Resend' } as const satisfies Record<
  EmailProvider,
  string
>

// Where SES's API (SendEmail) takes an email, at an endpoint like
// https://email.us-east-1.amazonaws.com.
export const sesUrl = (endpoint: string) => new URL(`${endpoint}/v2/email/outbound-emails`)

// Email as /admin/integrations shows it. The secret's last characters say which one is saved,
// without showing it.
export type EmailStatus =
  | { readonly _tag: 'NotSetUp' }
  | { readonly _tag: 'SetUp'; readonly settings: EmailSettings; readonly secretEnding: string }
  | { readonly _tag: 'SecretUnreadable'; readonly settings: EmailSettings }

export interface EmailMessage {
  readonly to: string
  readonly subject: string
  readonly text: string
}

// There's nothing to send it with.
export class EmailNotSetUp extends Schema.TaggedError<EmailNotSetUp>()('EmailNotSetUp', {}) {}

// The address to send to isn't one.
export class EmailAddressInvalid extends Schema.TaggedError<EmailAddressInvalid>()(
  'EmailAddressInvalid',
  {},
) {}

// SES or Resend didn't take it, with why, in its words, for the admin setting it up.
export class EmailNotSent extends Schema.TaggedError<EmailNotSent>()('EmailNotSent', {
  message: Schema.String,
}) {}

export type EmailFailure = EmailNotSetUp | SecretUnreadable | EmailAddressInvalid | EmailNotSent

// Why SES or Resend refused it: SES says `message` (or `Message`), with the kind of error in a
// header, and Resend says `message`.
const RefusalAnswer = Schema.Struct({
  message: Schema.optionalKey(Schema.String),
  Message: Schema.optionalKey(Schema.String),
})
const decodeRefusal = Schema.decodeUnknownEffect(RefusalAnswer)

// The From header's name and address: the name quoted, or for SES, which takes only ASCII there,
// encoded (RFC 2047) when it isn't. Without a name, it's the address alone.
function mailbox(name: string, address: string, provider: EmailProvider): string {
  if (!name) return address
  if (provider === 'ses' && !/^[\x20-\x7e]*$/.test(name)) {
    return `=?UTF-8?B?${Buffer.from(name).toString('base64')}?= <${address}>`
  }
  return `"${name.replace(/[\\"]/g, '\\$&')}" <${address}>`
}

// RFC 3986's encoding, as AWS signs with.
const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
const sha256 = (data: string) => createHash('sha256').update(data).digest('hex')
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest()

// The headers that sign a request to AWS (Signature Version 4): `x-amz-date` and `authorization`,
// with the ones given, all lowercase. The host is signed too, but left for fetch to send.
// https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html
export function signAwsRequest(request: {
  method: string
  url: URL
  headers: Record<string, string>
  body: string
  region: string
  service: string
  accessKeyId: string
  secretAccessKey: string
  now: Date
}): Record<string, string> {
  let { method, url, body, region, service, accessKeyId, secretAccessKey, now } = request
  let time = now.toISOString().replace(/[-:]|\.\d{3}/g, '')
  let date = time.slice(0, 8)
  let headers: Record<string, string> = { ...request.headers, 'x-amz-date': time }
  let signed: Record<string, string> = { ...headers, host: url.host }
  let names = Object.keys(signed).sort()
  let query = [...url.searchParams]
    .map(([key, value]) => `${encode(key)}=${encode(value)}`)
    .sort()
    .join('&')
  let canonical = [
    method,
    url.pathname.split('/').map(encode).join('/'),
    query,
    names.map((name) => `${name}:${signed[name]?.trim()}\n`).join(''),
    names.join(';'),
    sha256(body),
  ].join('\n')
  let scope = `${date}/${region}/${service}/aws4_request`
  let key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), service), 'aws4_request')
  let signature = createHmac('sha256', key)
    .update(['AWS4-HMAC-SHA256', time, scope, sha256(canonical)].join('\n'))
    .digest('hex')
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
  }
}

interface Fields {
  readonly from: string
  readonly replyTo: string
  readonly message: EmailMessage
}

export class Email extends Context.Service<
  Email,
  {
    readonly status: Effect.Effect<EmailStatus>
    // Sends a plain-text email from the site, as its settings say.
    readonly send: (message: EmailMessage) => Effect.Effect<void, EmailFailure>
  }
>()('logspace/Email') {
  static readonly layer = Layer.effect(
    Email,
    Effect.gen(function* () {
      let queries = yield* SiteConfigQueries
      let secrets = yield* Secrets
      let client = yield* HttpClient.HttpClient

      let secretOf = (provider: EmailSettings['provider']) =>
        provider._tag === 'ses'
          ? secrets.open(provider.secretAccessKey, EMAIL_SECRET_PURPOSES.ses)
          : secrets.open(provider.apiKey, EMAIL_SECRET_PURPOSES.resend)

      let status = Effect.gen(function* () {
        let settings = (yield* queries.saved).email
        if (!settings) return { _tag: 'NotSetUp' } as const
        return yield* secretOf(settings.provider).pipe(
          Effect.match({
            onSuccess: (secret) =>
              ({ _tag: 'SetUp', settings, secretEnding: secret.slice(-4) }) as const,
            onFailure: () => ({ _tag: 'SecretUnreadable', settings }) as const,
          }),
        )
      }).pipe(Effect.withSpan('Email.status'))

      // Sends the request, succeeding if it's accepted, or failing with why not.
      let deliver = (provider: EmailProvider, request: HttpClientRequest.HttpClientRequest) => {
        let name = PROVIDER_NAMES[provider]
        return client.execute(request).pipe(
          Effect.catchTag('HttpClientError', () =>
            Effect.fail(
              new EmailNotSent({
                message: `Couldn’t reach ${name} at ${new URL(request.url).origin}.`,
              }),
            ),
          ),
          Effect.flatMap((response) => {
            if (response.status >= 200 && response.status < 300) return Effect.void
            // Like "MessageRejected:http://internal.amazon.com/coral/…".
            let kind = response.headers['x-amzn-errortype']?.split(':')[0]
            return response.json.pipe(
              Effect.flatMap(decodeRefusal),
              Effect.map((answer) => answer.message ?? answer.Message),
              Effect.orElseSucceed(() => undefined),
              Effect.flatMap((said) =>
                Effect.fail(
                  new EmailNotSent({
                    message:
                      [kind, said].filter(Boolean).join(': ') ||
                      `${name} answered with HTTP ${response.status}.`,
                  }),
                ),
              ),
            )
          }),
        )
      }

      let sesRequest = (
        provider: typeof SesProvider.Type,
        secretAccessKey: string,
        fields: Fields,
        now: Date,
      ) => {
        let url = sesUrl(provider.endpoint)
        let body = JSON.stringify({
          FromEmailAddress: fields.from,
          Destination: { ToAddresses: [fields.message.to] },
          ...(fields.replyTo ? { ReplyToAddresses: [fields.replyTo] } : {}),
          Content: {
            Simple: {
              Subject: { Data: fields.message.subject, Charset: 'UTF-8' },
              Body: { Text: { Data: fields.message.text, Charset: 'UTF-8' } },
            },
          },
        })
        let headers = signAwsRequest({
          method: 'POST',
          url,
          headers: { 'content-type': 'application/json' },
          body,
          region: provider.region,
          service: 'ses',
          accessKeyId: provider.accessKeyId,
          secretAccessKey,
          now,
        })
        return HttpClientRequest.post(url).pipe(
          HttpClientRequest.bodyText(body, 'application/json'),
          HttpClientRequest.setHeaders(headers),
        )
      }

      let resendRequest = (apiKey: string, fields: Fields) =>
        HttpClientRequest.post(RESEND_URL).pipe(
          HttpClientRequest.bearerToken(apiKey),
          HttpClientRequest.bodyJsonUnsafe({
            from: fields.from,
            to: [fields.message.to],
            ...(fields.replyTo ? { reply_to: fields.replyTo } : {}),
            subject: fields.message.subject,
            text: fields.message.text,
          }),
        )

      let send = Effect.fn('Email.send')(function* (message: EmailMessage) {
        let settings = (yield* queries.saved).email
        if (!settings) return yield* new EmailNotSetUp()
        if (!isEmailAddress(message.to)) return yield* new EmailAddressInvalid()
        let { provider, replyTo } = settings
        let secret = yield* secretOf(provider)
        let fields = {
          from: mailbox(settings.fromName, settings.from, provider._tag),
          replyTo,
          message,
        }
        let request =
          provider._tag === 'ses'
            ? sesRequest(provider, secret, fields, DateTime.toDateUtc(yield* DateTime.now))
            : resendRequest(secret, fields)
        yield* deliver(provider._tag, request).pipe(
          Effect.timeoutOrElse({
            duration: TIMEOUT,
            orElse: () =>
              Effect.fail(new EmailNotSent({ message: 'No answer within 30 seconds.' })),
          }),
          Effect.tapError((error) =>
            Effect.logWarning('Email not sent').pipe(
              Effect.annotateLogs({ provider: provider._tag, reason: error.message }),
            ),
          ),
        )
      })

      return Email.of({ status, send })
    }),
  )
}
