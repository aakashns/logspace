// /admin/integrations: saving Turnstile's keys (its secret key sealed), disconnecting it, and
// checking its widget's answer with Cloudflare, which a fake network answers for.
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { Effect, Fiber, Redacted } from 'effect'
import { SqlClient } from 'effect/sql'
import { TestClock } from 'effect/testing'

import { capture, defined, makeTestApp } from '../../../../test/app.ts'
import { TEST_SITE_CONFIG } from '../../../../test/seed.ts'
import { SiteConfigCommands } from '../../../data/site/commands.ts'
import { TURNSTILE_SECRET_PURPOSE } from '../../../data/site/site.ts'
import { Turnstile } from '../../../data/site/turnstile.ts'
import { SealedSecret, Secrets } from '../../../lib/secrets.ts'

const SITE_KEY = '0x4AAAAAAAsiteKey123'
const SECRET_KEY = '0x4AAAAAAAsecretKey456789'
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

// What the fake network was asked, and how it answers.
let requests: { url: string; method: string | undefined; body: URLSearchParams }[] = []
let answer: () => Promise<Response> = () => Promise.reject(new Error('No answer set'))
const answerJson = (body: unknown, status = 200) => {
  answer = () => Promise.resolve(Response.json(body, { status }))
}

const app = makeTestApp(
  {},
  {
    network: {
      resolve: () => Promise.reject(new Error('Not expected')),
      fetch: async (url, init) => {
        requests.push({
          url: url.href,
          method: init.method,
          body: new URLSearchParams(await new Response(init.body).text()),
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
  (
    await sql<{ value: string }>(
      (sql) => sql<{ value: string }>`select value from config where key = 'turnstile'`,
    )
  )[0]?.value
const setRow = (value: string) =>
  sql(
    (sql) =>
      sql`insert into config (key, value) values ('turnstile', ${value})
        on conflict (key) do update set value = excluded.value`,
  )
const savedSecret = async () => {
  let row = JSON.parse(defined(await savedRow(), 'a saved row'))
  return app.run(
    Effect.flatMap(Secrets, (secrets) =>
      secrets.open(SealedSecret.make(row.secretKey), TURNSTILE_SECRET_PURPOSE),
    ),
  )
}

const login = async () => defined(app.sessionCookie(await app.logIn()), 'a session cookie')
const post = (path: string, fields: Record<string, string>, cookie: string) =>
  app.fetch(path, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: new URLSearchParams(fields),
  })
const page = async (cookie?: string) =>
  app.fetch('/admin/integrations', { headers: { Cookie: cookie ?? (await login()) } })
const saveKeys = async (fields: Record<string, string>) => {
  let cookie = await login()
  let response = await post('/admin/integrations/turnstile', fields, cookie)
  return { response, cookie: app.sessionCookie(response) ?? cookie }
}
const connect = () => saveKeys({ siteKey: SITE_KEY, secretKey: SECRET_KEY })
const verify = async (token: string | undefined) =>
  post(
    '/admin/integrations/turnstile/verify',
    token === undefined ? {} : { 'cf-turnstile-response': token },
    await login(),
  )
const alert = (html: string) =>
  capture(
    html,
    /<div data-slot="alert" data-variant="destructive" role="alert">([^]*?)<\/div><\/div>/,
  )

describe('/admin/integrations', () => {
  it('is only for the admin, and nothing is saved or checked without a login', async () => {
    let response = await app.fetch('/admin/integrations')
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('/admin/login')
    for (let path of ['', '/remove', '/verify']) {
      let fields = { siteKey: SITE_KEY, secretKey: SECRET_KEY, 'cf-turnstile-response': 'token' }
      let sent = await app.fetch(`/admin/integrations/turnstile${path}`, {
        method: 'POST',
        body: new URLSearchParams(fields),
      })
      expect(sent.status).toBe(302)
    }
    expect(await savedRow()).toBeUndefined()
    expect(requests).toEqual([])
  })

  it('refuses a form from another site', async () => {
    let cookie = await login()
    let response = await app.fetch('/admin/integrations/turnstile', {
      method: 'POST',
      headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' },
      body: new URLSearchParams({ siteKey: SITE_KEY, secretKey: SECRET_KEY }),
    })
    expect(response.status).toBe(403)
    expect(await savedRow()).toBeUndefined()
  })

  it('shows Turnstile as not connected, without the widget or letting Cloudflare’s script run', async () => {
    let response = await page()
    let html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toMatch(/<title>Integrations · Test Site<\/title>/)
    expect(html).toContain('Cloudflare Turnstile')
    expect(html).toContain('Not connected')
    expect(html).toContain('action="/admin/integrations/turnstile"')
    expect(html).not.toContain('Disconnect')
    expect(html).not.toContain('placeholder=')
    expect(html).not.toContain('class="cf-turnstile"')
    expect(html).not.toContain('challenges.cloudflare.com/turnstile/v0/api.js')
    expect(response.headers.get('Content-Security-Policy')).not.toContain('cloudflare')
  })
})

describe('saving Turnstile’s keys', () => {
  it('saves the site key, and the secret key sealed, then shows the widget', async () => {
    let { response, cookie } = await connect()
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe('/admin/integrations')

    let row = JSON.parse(defined(await savedRow(), 'a saved row'))
    expect(row.siteKey).toBe(SITE_KEY)
    expect(row.secretKey).toMatch(/^v1\./)
    expect(await savedRow()).not.toContain(SECRET_KEY)
    expect(await savedSecret()).toBe(SECRET_KEY)

    let shown = await page(cookie)
    let html = await shown.text()
    expect(html).toMatch(/role="status"><div data-slot="alert-title">\s*Saved\./)
    expect(html).toContain('Until then, logging in goes ahead without it.')
    expect(html).toContain('>Connected<')
    expect(html).toContain(`value="${SITE_KEY}"`)
    expect(html).toContain('placeholder="••••••••••••6789"')
    expect(html).toContain('Leave it empty to keep the saved one.')
    expect(html).not.toContain(SECRET_KEY)
    expect(html).toContain(`<div class="cf-turnstile" data-sitekey="${SITE_KEY}" data-ignore>`)
    expect(html).toContain('<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"')
    expect(html).toContain('action="/admin/integrations/turnstile/verify"')
    expect(html).toContain('formaction="/admin/integrations/turnstile/remove"')
    let csp = defined(shown.headers.get('Content-Security-Policy'), 'a CSP')
    expect(csp).toMatch(/script-src 'nonce-[0-9a-f]+' https:\/\/challenges\.cloudflare\.com;/)
    expect(csp).toContain('frame-src https://challenges.cloudflare.com')
    expect(csp).toContain("require-trusted-types-for 'script'")

    // The note is shown once.
    let again = await (await page(defined(app.sessionCookie(shown), 'a cookie'))).text()
    expect(again).not.toContain('Saved.')
  })

  it('trims keys pasted with spaces or a line break', async () => {
    await saveKeys({ siteKey: ` ${SITE_KEY}\n`, secretKey: `\t${SECRET_KEY} \r\n` })
    expect(JSON.parse(defined(await savedRow(), 'a saved row')).siteKey).toBe(SITE_KEY)
    expect(await savedSecret()).toBe(SECRET_KEY)
  })

  it('needs both keys the first time', async () => {
    let { response } = await saveKeys({ siteKey: '', secretKey: '' })
    let html = await response.text()
    expect(response.status).toBe(400)
    expect(alert(html)).toContain('Site key: Enter the widget’s site key')
    expect(alert(html)).toContain('Secret key: Enter the widget’s secret key')
    expect(html).toMatch(/id="turnstile-siteKey" name="siteKey" value="" aria-invalid="true"/)
    expect(html).toMatch(/id="turnstile-secretKey"[^>]*aria-invalid="true"/)
    expect(await savedRow()).toBeUndefined()

    // A missing field is like an empty one.
    expect((await saveKeys({})).response.status).toBe(400)
  })

  it('refuses keys that can’t be Cloudflare’s, showing the site key typed but not the secret', async () => {
    for (let [siteKey, secretKey, message] of [
      ['0x4AAA site key', SECRET_KEY, 'Site key: Expected a key from Cloudflare'],
      ['short', SECRET_KEY, 'Site key: Expected a key from Cloudflare'],
      ['<script>alert(1)</script>', SECRET_KEY, 'Site key: Expected a key from Cloudflare'],
      [SITE_KEY, 'secret"key/with+symbols', 'Secret key: Expected a key from Cloudflare'],
      [SITE_KEY, 'x'.repeat(201), 'Secret key: Expected a key from Cloudflare'],
      [SITE_KEY, SITE_KEY, 'Secret key: That’s the site key; copy the secret key'],
    ] as const) {
      let { response } = await saveKeys({ siteKey, secretKey })
      let html = await response.text()
      expect(response.status).toBe(400)
      expect(alert(html)).toContain(message)
      if (secretKey !== siteKey) expect(html).not.toContain(`value="${secretKey}"`)
      expect(html).not.toContain('<script>alert(1)</script>')
    }
    let { response } = await saveKeys({ siteKey: 'bad site key', secretKey: SECRET_KEY })
    expect(await response.text()).toContain('value="bad site key"')
    expect(await savedRow()).toBeUndefined()
  })

  it('keeps the saved secret key when it’s left empty, and replaces it when one is typed', async () => {
    await connect()
    let sealed = JSON.parse(defined(await savedRow(), 'a saved row')).secretKey

    let kept = await saveKeys({ siteKey: '0x4AAAAAAAnewSiteKey', secretKey: '' })
    expect(kept.response.status).toBe(303)
    let row = JSON.parse(defined(await savedRow(), 'a saved row'))
    expect(row).toEqual({ siteKey: '0x4AAAAAAAnewSiteKey', secretKey: sealed })

    // A rejected form leaves the saved keys as they were.
    expect((await saveKeys({ siteKey: '', secretKey: '' })).response.status).toBe(400)
    expect(JSON.parse(defined(await savedRow(), 'a saved row'))).toEqual(row)

    await saveKeys({ siteKey: SITE_KEY, secretKey: '0x4AAAAAAAanotherSecret' })
    expect(await savedSecret()).toBe('0x4AAAAAAAanotherSecret')
  })

  it('asks for the secret key again when it can’t be read, as after AUTH_SESSION_SECRET changes', async () => {
    let sealedElsewhere = await otherSecret.run(
      Effect.flatMap(Secrets, (secrets) => secrets.seal(SECRET_KEY, TURNSTILE_SECRET_PURPOSE)),
    )
    await setRow(JSON.stringify({ siteKey: SITE_KEY, secretKey: sealedElsewhere }))

    let html = await (await page()).text()
    expect(html).toContain('Needs its secret key again')
    expect(html).toContain('The saved secret key can’t be read')
    expect(html).not.toContain('placeholder=')
    // The widget still shows: the site key is fine.
    expect(html).toContain(`data-sitekey="${SITE_KEY}"`)

    let { response } = await saveKeys({ siteKey: SITE_KEY, secretKey: '' })
    expect(response.status).toBe(400)
    expect(alert(await response.text())).toContain('Secret key: The saved secret key can’t be read')

    expect((await connect()).response.status).toBe(303)
    expect(await savedSecret()).toBe(SECRET_KEY)
  })

  it('treats a mangled setting as not connected', async () => {
    for (let value of [
      'not json',
      '{}',
      JSON.stringify({ siteKey: SITE_KEY }),
      JSON.stringify({ siteKey: SITE_KEY, secretKey: SECRET_KEY }),
      JSON.stringify({
        siteKey: 'bad key',
        secretKey: 'v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAA',
      }),
    ]) {
      await setRow(value)
      let html = await (await page()).text()
      expect(html).toContain('Not connected')
      expect(html).not.toContain('class="cf-turnstile"')
    }
    // Saving over it works.
    expect((await connect()).response.status).toBe(303)
  })

  it('disconnects, forgetting the keys', async () => {
    await connect()
    let cookie = await login()
    let response = await post('/admin/integrations/turnstile/remove', {}, cookie)
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe('/admin/integrations')
    expect(await savedRow()).toBeUndefined()
    let html = await (await page(defined(app.sessionCookie(response), 'a cookie'))).text()
    expect(html).toContain('Disconnected, and its keys forgotten.')
    expect(html).toContain('Not connected')

    // Disconnecting again does nothing.
    expect((await post('/admin/integrations/turnstile/remove', {}, cookie)).status).toBe(303)
  })

  it('is left alone by saving the branding, and replaced by saving every setting', async () => {
    await connect()
    let row = await savedRow()
    let form = new URLSearchParams({ ...TEST_SITE_CONFIG, siteTitle: 'Renamed' })
    let cookie = await login()
    let saved = await app.fetch('/admin/branding', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: form,
    })
    expect(saved.status).toBe(303)
    expect(await savedRow()).toBe(row)

    await app.run(Effect.flatMap(SiteConfigCommands, (commands) => commands.save(TEST_SITE_CONFIG)))
    expect(await savedRow()).toBeUndefined()
  })
})

describe('verifying the widget’s answer', () => {
  it('needs Turnstile to be connected, without asking Cloudflare', async () => {
    let response = await verify('token')
    expect(response.status).toBe(409)
    expect(alert(await response.text())).toContain(
      'Turnstile isn’t connected: save its keys first.',
    )
    expect(requests).toEqual([])
  })

  it('needs a secret key it can read, without asking Cloudflare', async () => {
    await setRow(
      JSON.stringify({
        siteKey: SITE_KEY,
        secretKey: await otherSecret.run(
          Effect.flatMap(Secrets, (secrets) => secrets.seal(SECRET_KEY, TURNSTILE_SECRET_PURPOSE)),
        ),
      }),
    )
    let response = await verify('token')
    expect(response.status).toBe(409)
    expect(alert(await response.text())).toContain('The saved secret key can’t be read')
    expect(requests).toEqual([])
  })

  it('needs the challenge completed, and a token Cloudflare could have made', async () => {
    await connect()
    for (let token of [undefined, '', '   ']) {
      let response = await verify(token)
      expect(response.status).toBe(400)
      expect(alert(await response.text())).toContain('Complete the challenge first.')
    }
    let tooLong = await verify('x'.repeat(2049))
    expect(tooLong.status).toBe(400)
    expect(alert(await tooLong.text())).toContain('The challenge’s answer isn’t valid.')
    expect(requests).toEqual([])
  })

  it('asks Cloudflare with the secret key, and says so when it accepts the answer', async () => {
    await connect()
    answerJson({
      success: true,
      challenge_ts: '2026-10-25T09:00:00.000Z',
      hostname: 'example.com',
      'error-codes': [],
      action: '',
      cdata: '',
    })
    let response = await verify('the-token')
    let html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toMatch(
      /role="status"><div data-slot="alert-title">\s*Verified: Cloudflare accepted the answer, solved on example\.com\. Turnstile works\.\s*<\/div>/,
    )
    expect(requests).toHaveLength(1)
    let [request] = requests
    expect(request?.url).toBe(SITEVERIFY)
    expect(request?.method).toBe('POST')
    expect(request?.body.get('secret')).toBe(SECRET_KEY)
    expect(request?.body.get('response')).toBe('the-token')
    // The page shows the widget again, for another try.
    expect(html).toContain(`data-sitekey="${SITE_KEY}"`)
    expect(html).not.toContain(SECRET_KEY)
    // Logging in on the site it was solved on now requires it.
    expect(JSON.parse(defined(await savedRow(), 'a saved row')).verifiedHostname).toBe(
      'example.com',
    )
    expect(html).toContain('Logging in on example.com requires it')
  })

  it('explains each reason Cloudflare refuses an answer', async () => {
    await connect()
    for (let [codes, message] of [
      [['invalid-input-secret'], 'Cloudflare doesn’t recognize the secret key.'],
      [['missing-input-secret'], 'Cloudflare didn’t get the secret key.'],
      [['invalid-input-response'], 'The challenge’s answer isn’t valid.'],
      [['missing-input-response'], 'Cloudflare didn’t get the challenge’s answer.'],
      [['timeout-or-duplicate'], 'expired (they last five minutes) or was already verified'],
      [['bad-request'], 'Cloudflare refused the request as malformed.'],
      [['internal-error'], 'Cloudflare had an internal error. Try again.'],
      [['something-new'], 'Cloudflare refused the answer: something-new.'],
      [[], 'Cloudflare refused the answer, without saying why.'],
    ] as const) {
      answerJson({ success: false, 'error-codes': codes })
      let response = await verify('the-token')
      expect(response.status).toBe(400)
      expect(alert(await response.text())).toContain(message)
    }
    // Without error codes at all, too.
    answerJson({ success: false })
    expect(alert(await (await verify('the-token')).text())).toContain('without saying why')
    // Two reasons at once are both shown.
    answerJson({
      success: false,
      'error-codes': ['invalid-input-secret', 'invalid-input-response'],
    })
    let both = alert(await (await verify('the-token')).text())
    expect(both).toContain('recognize the secret key')
    expect(both).toContain('answer isn’t valid')
  })

  it('says when Cloudflare can’t be reached, or answers with an error or nonsense', async () => {
    await connect()
    let cases: [() => Promise<Response>, string][] = [
      [() => Promise.reject(new Error('ECONNREFUSED')), 'Couldn’t reach Cloudflare.'],
      [
        () => Promise.resolve(new Response('Bad gateway', { status: 502 })),
        'Cloudflare answered with an error (HTTP 502).',
      ],
      [
        () => Promise.resolve(Response.json({ success: true }, { status: 429 })),
        'Cloudflare answered with an error (HTTP 429).',
      ],
      [
        () => Promise.resolve(new Response('<html>not json</html>')),
        'Cloudflare’s answer couldn’t be read.',
      ],
      [() => Promise.resolve(Response.json({ ok: true })), 'Cloudflare’s answer couldn’t be read.'],
      [
        () => Promise.resolve(Response.json({ success: 'yes' })),
        'Cloudflare’s answer couldn’t be read.',
      ],
    ]
    for (let [respond, message] of cases) {
      answer = respond
      let response = await verify('the-token')
      expect(response.status).toBe(502)
      expect(alert(await response.text())).toContain(message)
    }
  })

  it('gives up on Cloudflare after 10 seconds', async () => {
    await connect()
    let asked = Promise.withResolvers<void>()
    answer = () => {
      asked.resolve()
      return new Promise<Response>(() => {})
    }
    let failure = await app.run(
      Effect.gen(function* () {
        let turnstile = yield* Turnstile
        let fiber = yield* Effect.forkChild(Effect.flip(turnstile.verify('the-token')))
        yield* Effect.promise(() => asked.promise)
        yield* TestClock.adjust('9 seconds')
        expect(fiber.pollUnsafe()).toBeUndefined()
        yield* TestClock.adjust('1 second')
        return yield* Fiber.join(fiber)
      }).pipe(Effect.provide(TestClock.layer())),
    )
    expect(failure).toMatchObject({ _tag: 'TurnstileUnavailable', reason: 'timeout' })
  })
})
