// Signing requests to AWS, against the example in AWS's documentation.
import { describe, expect, it } from 'bun:test'

import { signAwsRequest } from './email.ts'

describe('signAwsRequest', () => {
  it('signs as AWS’s example does', () => {
    // https://docs.aws.amazon.com/IAM/latest/UserGuide/create-signed-request.html (IAM ListUsers)
    let headers = signAwsRequest({
      method: 'GET',
      url: new URL('https://iam.amazonaws.com/?Version=2010-05-08&Action=ListUsers'),
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: '',
      region: 'us-east-1',
      service: 'iam',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      now: new Date('2015-08-30T12:36:00Z'),
    })
    expect(headers).toEqual({
      'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
      'x-amz-date': '20150830T123600Z',
      authorization:
        'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, ' +
        'SignedHeaders=content-type;host;x-amz-date, ' +
        'Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
    })
  })
})
