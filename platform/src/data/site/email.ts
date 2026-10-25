// Email, set up at /admin/integrations: whether it's set up, and sending a message, through an
// SMTP server (with nodemailer, which talks to it over its own socket) or Resend's API.
// https://nodemailer.com/smtp/ and https://resend.com/docs/api-reference/emails/send-email
import { Context, Duration, Effect, Layer, Schema } from 'effect'
import { HttpClient, HttpClientRequest } from 'effect/http'
import nodemailer from 'nodemailer'

import { Secrets, SecretUnreadable } from '../../lib/secrets.ts'
import { SiteConfigQueries } from './queries.ts'
import {
  EMAIL_SECRET_PURPOSES,
  type EmailSettings,
  isEmailAddress,
  type SmtpProvider,
} from './site.ts'

const RESEND_URL = 'https://api.resend.com/emails'
const TIMEOUT = Duration.seconds(30)

// Email as /admin/integrations shows it. The password or API key's last characters say which one
// is saved, without showing it.
export type EmailStatus =
  | { readonly _tag: 'NotSetUp' }
  | {
      readonly _tag: 'SetUp'
      readonly settings: EmailSettings
      readonly secretEnding: string | undefined
    }
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

// The server or Resend didn't take it, with why, in its words, for the admin setting it up.
export class EmailNotSent extends Schema.TaggedError<EmailNotSent>()('EmailNotSent', {
  message: Schema.String,
}) {}

export type EmailFailure = EmailNotSetUp | SecretUnreadable | EmailAddressInvalid | EmailNotSent

// The parts of Resend's answer that are used: the email's id, or why it was refused.
const ResendResponse = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  message: Schema.optionalKey(Schema.String),
})
const decodeResendResponse = Schema.decodeUnknownEffect(ResendResponse)

const unreadable = (status: number) =>
  Effect.fail(new EmailNotSent({ message: `Resend’s answer (HTTP ${status}) couldn’t be read.` }))

const notSent = (cause: unknown) =>
  new EmailNotSent({
    message: cause instanceof Error && cause.message ? cause.message : 'The email wasn’t sent.',
  })

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
        provider._tag === 'smtp'
          ? provider.password && secrets.open(provider.password, EMAIL_SECRET_PURPOSES.smtp)
          : secrets.open(provider.apiKey, EMAIL_SECRET_PURPOSES.resend)

      let status = Effect.gen(function* () {
        let settings = (yield* queries.saved).email
        if (!settings) return { _tag: 'NotSetUp' } as const
        let secret = secretOf(settings.provider)
        if (!secret) return { _tag: 'SetUp', settings, secretEnding: undefined } as const
        return yield* secret.pipe(
          Effect.match({
            onSuccess: (opened) =>
              ({ _tag: 'SetUp', settings, secretEnding: opened.slice(-4) }) as const,
            onFailure: () => ({ _tag: 'SecretUnreadable', settings }) as const,
          }),
        )
      }).pipe(Effect.withSpan('Email.status'))

      // One connection for each email, closed once it's sent.
      let sendSmtp = (
        provider: typeof SmtpProvider.Type,
        password: string | undefined,
        from: { name: string; address: string },
        replyTo: string,
        message: EmailMessage,
      ) =>
        Effect.acquireUseRelease(
          Effect.sync(() =>
            nodemailer.createTransport({
              host: provider.host,
              port: provider.port,
              secure: provider.security === 'tls',
              requireTLS: provider.security === 'starttls',
              ignoreTLS: provider.security === 'none',
              ...(provider.username && password
                ? { auth: { user: provider.username, pass: password } }
                : {}),
              connectionTimeout: 10_000,
              greetingTimeout: 10_000,
              socketTimeout: 20_000,
            }),
          ),
          (transport) =>
            Effect.tryPromise({
              try: () =>
                transport.sendMail({
                  from,
                  to: message.to,
                  ...(replyTo ? { replyTo } : {}),
                  subject: message.subject,
                  text: message.text,
                }),
              catch: notSent,
            }),
          (transport) => Effect.sync(() => transport.close()),
        )

      let sendResend = (
        apiKey: string,
        from: { name: string; address: string },
        replyTo: string,
        message: EmailMessage,
      ) =>
        client
          .execute(
            HttpClientRequest.post(RESEND_URL).pipe(
              HttpClientRequest.bearerToken(apiKey),
              HttpClientRequest.bodyJsonUnsafe({
                // A quoted name, escaped as JSON escapes it, which is how email does too.
                from: from.name ? `${JSON.stringify(from.name)} <${from.address}>` : from.address,
                to: [message.to],
                ...(replyTo ? { reply_to: replyTo } : {}),
                subject: message.subject,
                text: message.text,
              }),
            ),
          )
          .pipe(
            Effect.catchTag('HttpClientError', () =>
              Effect.fail(
                new EmailNotSent({
                  message: 'Couldn’t reach Resend. Check the server’s connection to the internet.',
                }),
              ),
            ),
            Effect.flatMap((response) =>
              response.json.pipe(
                Effect.flatMap(decodeResendResponse),
                Effect.flatMap((answer) =>
                  response.status >= 200 && response.status < 300
                    ? Effect.void
                    : Effect.fail(
                        new EmailNotSent({
                          message:
                            answer.message ?? `Resend answered with HTTP ${response.status}.`,
                        }),
                      ),
                ),
                Effect.catchTags({
                  HttpClientError: () => unreadable(response.status),
                  SchemaError: () => unreadable(response.status),
                }),
              ),
            ),
          )

      let send = Effect.fn('Email.send')(function* (message: EmailMessage) {
        let saved = yield* queries.saved
        let settings = saved.email
        if (!settings) return yield* new EmailNotSetUp()
        if (!isEmailAddress(message.to)) return yield* new EmailAddressInvalid()
        let secret = secretOf(settings.provider)
        let opened = secret ? yield* secret : undefined
        let from = { name: saved.siteTitle ?? '', address: settings.from }
        let { provider, replyTo } = settings
        yield* (
          provider._tag === 'smtp'
            ? sendSmtp(provider, opened, from, replyTo, message)
            : sendResend(opened ?? '', from, replyTo, message)
        ).pipe(
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
