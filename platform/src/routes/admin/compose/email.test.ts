// Emailing a new post to everyone subscribed, with Resend, which a fake network answers for: the
// post as its page shows it, in the app's styles, light or dark as the reader's system is.
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { defined, makeTestApp } from '../../../../test/app.ts'
import { SiteConfigCommands } from '../../../data/site/commands.ts'

const RESEND = 'https://api.resend.com/emails'

interface Sent {
  readonly to: string
  readonly subject: string
  readonly text: string
  readonly html: string
}

// The emails Resend was asked to send, and the tests waiting for some. Resend refuses the
// addresses in `refused`.
let emails: Sent[] = []
let waiting: { count: number; resolve: () => void }[] = []
let refused = new Set<string>()
const sent = (count: number) =>
  new Promise<void>((resolve) => {
    waiting.push({ count, resolve })
    settle()
  })
const settle = () => {
  for (let wait of waiting.filter((wait) => emails.length >= wait.count)) wait.resolve()
  waiting = waiting.filter((wait) => emails.length < wait.count)
}

const app = makeTestApp(
  {},
  {
    network: {
      resolve: () => Promise.reject(new Error('Not expected')),
      fetch: async (url, init) => {
        if (url.href !== RESEND) throw new Error(`Not expected: ${url.href}`)
        let { to, subject, text, html } = JSON.parse(await new Response(init.body).text())
        emails.push({ to: to[0], subject, text, html })
        settle()
        if (refused.has(to[0])) return Response.json({ message: 'Refused' }, { status: 422 })
        return Response.json({ id: 'sent' })
      },
    },
  },
)

const subscribe = (...addresses: string[]) =>
  app.run(
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      Effect.forEach(
        addresses,
        (email, index) =>
          sql`insert into users ${sql.insert({
            id: crypto.randomUUID(),
            name: email,
            email,
            email_verified: 1,
            created_at: `2026-10-0${index + 1}T00:00:00.000Z`,
            updated_at: `2026-10-0${index + 1}T00:00:00.000Z`,
          })}`,
      ),
    ).pipe(Effect.orDie),
  )

const photo = (name: string) =>
  new File([Bun.file('test/content/posts/drdp3ei6fd/hike-1.jpg')], name, { type: 'image/jpeg' })
const composerPost = (path: string, fields: [string, string | File][]) => {
  let body = new FormData()
  for (let [name, value] of fields) body.append(name, value)
  return app.adminFetch(path, { method: 'POST', body })
}
const publish = async (fields: [string, string | File][]) => {
  let response = await composerPost('/admin/posts', fields)
  expect(response.status).toBe(303)
}

beforeEach(async () => {
  await app.seedDatabase()
  await app.seedMedia()
  await app.run(
    Effect.flatMap(SiteConfigCommands, (commands) =>
      commands.saveEmail({
        provider: 'resend',
        fromName: 'Test Site',
        from: 'news@example.com',
        replyTo: '',
        hourlyLimit: '1000',
        sesRegion: '',
        sesEndpoint: '',
        sesAccessKeyId: '',
        sesSecretAccessKey: '',
        resendApiKey: 're_test_key_abcd1234',
      }),
    ),
  )
  emails = []
  waiting = []
  refused = new Set()
})
afterAll(app.dispose)

describe('a new post', () => {
  it('is emailed to each subscriber, as its page shows it, light or dark', async () => {
    await subscribe('ada@example.com', 'grace@example.com')
    let id = 'emailed001'
    await composerPost('/admin/posts/media', [
      ['post_id', id],
      ['image_uploads', photo('peak.jpg')],
    ])
    await publish([
      ['post_id', id],
      ['caption', 'Up top\n\nSee https://example.org'],
      ['photo', 'peak.jpg'],
    ])
    await sent(2)
    expect(emails.map((email) => email.to).toSorted()).toEqual([
      'ada@example.com',
      'grace@example.com',
    ])
    let [email] = emails
    let { subject, text, html } = defined(email, 'an email')
    expect(subject).toBe('Up top')
    expect(text).toBe(
      'Up top\nSee https://example.org\n\nhttps://example.com/posts/emailed001\n\n' +
        'You’re subscribed to Test Site (https://example.com).\n',
    )
    expect(html).toStartWith('<!DOCTYPE html><html lang="en">')
    expect(html).toContain('<meta name="color-scheme" content="light dark">')
    // Every URL is the site's full one.
    expect(html).toContain('<a href="https://example.com/posts/emailed001" class="permalink">')
    expect(html).toMatch(/<img src="https:\/\/example\.com\/posts\/emailed001\/peak\.jpg\?v=\w+"/)
    expect(html).toContain('srcset="https://example.com/posts/emailed001/peak.jpg?w=')
    expect(html).toContain('<div class="caption" data-ignore><p>Up top</p>')
    // The theme's colors are light, and dark while the reader's system is.
    expect(html).toContain('--background:oklch(.985 0 0)')
    expect(html).toContain('@media (prefers-color-scheme:dark){:root{--background:oklch(.2 0 0);')
    expect(html).not.toContain('--background:light-dark(')
  })

  it('is emailed once: not when it’s edited, or posted again', async () => {
    await subscribe('ada@example.com')
    let fields: [string, string][] = [
      ['post_id', 'emailed002'],
      ['caption', 'First'],
    ]
    await publish(fields)
    await sent(1)
    await publish(fields)
    await publish([
      ['post_id', 'emailed002'],
      ['caption', 'First, edited'],
    ])
    await publish([
      ['post_id', 'emailed003'],
      ['caption', 'Second'],
    ])
    await sent(2)
    expect(emails.map((email) => email.subject)).toEqual(['First', 'Second'])
  })

  it('goes on to the next subscriber past one it can’t be sent to', async () => {
    await subscribe('ada@example.com', 'grace@example.com')
    // Newest first.
    refused.add('grace@example.com')
    await publish([
      ['post_id', 'emailed004'],
      ['caption', 'Hello'],
    ])
    await sent(2)
    expect(emails.map((email) => email.to)).toEqual(['grace@example.com', 'ada@example.com'])
  })
})
