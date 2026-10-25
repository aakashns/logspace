// The site's fake of Amazon SES, outside production: /dev/ses/… takes an email as SES's API does,
// from the Email service set up with AWS's example key (see ../../../data/site/email.ts), checking
// its signature as SES would and answering with SES's errors, and /dev/emails shows what it took.
// https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html
import { DateTime, Effect, Layer, Schema } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'

import { EXAMPLE_AWS_KEY, sesUrl, signAwsRequest } from '../../../data/site/email.ts'
import { urls } from '../../../lib/urls.ts'
import { devOnly, devPage } from '../dev.tsx'
import { DevInbox } from './inbox.ts'
import { DEV_EMAILS_STYLES, DevEmailsPage } from './page.tsx'

// The parts of SendEmail's request that are kept: a simple email's.
const SendEmailRequest = Schema.Struct({
  FromEmailAddress: Schema.String,
  Destination: Schema.Struct({ ToAddresses: Schema.NonEmptyArray(Schema.String) }),
  ReplyToAddresses: Schema.optionalKey(Schema.Array(Schema.String)),
  Content: Schema.Struct({
    Simple: Schema.Struct({
      Subject: Schema.Struct({ Data: Schema.String }),
      Body: Schema.Struct({ Text: Schema.Struct({ Data: Schema.String }) }),
    }),
  }),
})
const decodeSendEmailRequest = Schema.decodeUnknownOption(Schema.fromJsonString(SendEmailRequest))

const AUTHORIZATION =
  /^AWS4-HMAC-SHA256 Credential=([^/]+)\/\d{8}\/([a-z0-9-]+)\/ses\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=[0-9a-f]{64}$/
// 20251025T120000Z.
const AMZ_DATE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/
// How far a request's time can be from the server's.
const SKEW_MS = 5 * 60 * 1000

// An error as SES answers with it: its kind in a header, and a message.
const refuse = (status: number, kind: string, message: string) =>
  HttpServerResponse.jsonUnsafe({ message }, { status, headers: { 'x-amzn-errortype': kind } })

const receive = (inbox: DevInbox['Service']) =>
  Effect.gen(function* () {
    let request = yield* HttpServerRequest.HttpServerRequest
    let body = yield* Effect.orDie(request.text)
    let { headers } = request
    let authorization = headers['authorization'] ?? ''
    let [, accessKeyId = '', region = '', signedHeaders = ''] =
      AUTHORIZATION.exec(authorization) ?? []
    if (!accessKeyId) {
      return refuse(403, 'MissingAuthenticationTokenException', 'Missing Authentication Token')
    }
    if (accessKeyId !== EXAMPLE_AWS_KEY.accessKeyId) {
      return refuse(
        403,
        'UnrecognizedClientException',
        'The security token included in the request is invalid.',
      )
    }
    let [, year, month, day, hours, minutes, seconds] =
      AMZ_DATE.exec(headers['x-amz-date'] ?? '') ?? []
    let time = new Date(`${year}-${month}-${day}T${hours}:${minutes}:${seconds}Z`)
    let now = DateTime.toEpochMillis(yield* DateTime.now)
    if (Number.isNaN(time.getTime()) || Math.abs(now - time.getTime()) > SKEW_MS) {
      return refuse(403, 'InvalidSignatureException', 'Signature expired or not yet valid.')
    }
    // Signed again with the example secret, as SES would at its own address.
    let names = signedHeaders.split(';').filter((name) => name !== 'host' && name !== 'x-amz-date')
    let expected = signAwsRequest({
      method: 'POST',
      url: sesUrl(region),
      headers: Object.fromEntries(names.map((name) => [name, headers[name] ?? ''])),
      body,
      region,
      service: 'ses',
      accessKeyId,
      secretAccessKey: EXAMPLE_AWS_KEY.secretAccessKey,
      now: time,
    })
    if (expected['authorization'] !== authorization) {
      return refuse(
        403,
        'InvalidSignatureException',
        'The request signature we calculated does not match the signature you provided. Check your AWS Secret Access Key and signing method.',
      )
    }
    let email = decodeSendEmailRequest(body)
    if (email._tag === 'None') {
      return refuse(
        400,
        'BadRequestException',
        'The request isn’t a SendEmail request for a simple email.',
      )
    }
    let { FromEmailAddress, Destination, ReplyToAddresses, Content } = email.value
    let id = crypto.randomUUID()
    yield* inbox.add({
      id,
      receivedAt: new Date(now),
      from: FromEmailAddress,
      to: Destination.ToAddresses,
      replyTo: ReplyToAddresses ?? [],
      subject: Content.Simple.Subject.Data,
      text: Content.Simple.Body.Text.Data,
    })
    return HttpServerResponse.jsonUnsafe({ MessageId: id })
  })

const emails = (inbox: DevInbox['Service']) =>
  Effect.gen(function* () {
    let received = yield* inbox.emails
    return yield* devPage(
      urls.dev.emails(),
      'Emails',
      DEV_EMAILS_STYLES,
      <DevEmailsPage emails={received} example={EXAMPLE_AWS_KEY} />,
    )
  })

// One inbox for both, kept as long as the server runs.
export const DevEmailRoutes = devOnly(
  Layer.unwrap(
    Effect.map(DevInbox, (inbox) =>
      HttpRouter.addAll([
        HttpRouter.route('POST', '/dev/ses/v2/email/outbound-emails', receive(inbox)),
        HttpRouter.route('GET', '/dev/emails', emails(inbox)),
      ]),
    ),
  ).pipe(Layer.provide(DevInbox.layer)),
)
