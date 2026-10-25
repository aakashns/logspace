// /admin and the parts it links to: the posts, and the subscribers.
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { capture, makeTestApp } from '../../../../test/app.ts'
import { PostQueries } from '../../../data/posts/queries.ts'

const app = makeTestApp()
const posts = () => app.run(Effect.flatMap(PostQueries, (queries) => queries.all))

beforeEach(app.seedDatabase)
afterAll(app.dispose)

describe('/admin', () => {
  it('has a link to each part of the admin', async () => {
    let response = await app.adminFetch('/admin')
    let html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toMatch(/<title>Manage Site · Test Site<\/title>/)
    let links = [...html.matchAll(/<a href="([^"]+)" class="link-card">.*?<h2[^>]*>([^<]+)<\/h2>/g)]
    expect(links.map(([, href, title]) => [href, title])).toEqual([
      ['/admin/posts', 'Manage Posts'],
      ['/admin/branding', 'Branding'],
      ['/admin/integrations', 'Integrations'],
      ['/admin/subscribers', 'Subscribers'],
    ])
  })

  it('sends the admin to the branding until the site is set up', async () => {
    await app.run(
      Effect.flatMap(SqlClient.SqlClient, (sql) => sql`delete from config`).pipe(Effect.orDie),
    )
    let response = await app.adminFetch('/admin')
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('/admin/branding')
    // Which has no link back to /admin, as that leads here.
    let html = await (await app.adminFetch('/admin/branding')).text()
    expect(html).not.toContain('class="back-link"')
  })

  it('is only for the admin, as are its parts', async () => {
    for (let path of ['/admin', '/admin/posts', '/admin/subscribers']) {
      let response = await app.fetch(path)
      expect(response.status).toBe(302)
      expect(response.headers.get('Location')).toBe('/admin/login')
    }
  })
})

describe('/admin/posts', () => {
  it('lists every post, newest first, each a link to edit it', async () => {
    let html = await (await app.adminFetch('/admin/posts')).text()
    expect(html).toMatch(/<title>Manage Posts · Test Site<\/title>/)
    expect(html).toMatch(/<a data-slot="button" [^>]*href="\/admin\/posts\/new">New Post<\/a>/)
    expect(html).toMatch(/<a data-slot="button" [^>]*href="\/admin" class="back-link">/)
    let rows = [...html.matchAll(/<li><a href="\/admin\/posts\/([^/]+)\/edit" class="post-row">/g)]
    expect(rows.map(([, id]) => id)).toEqual((await posts()).map((post) => post.id))
    // The whole row is the link: the date, the type, and the summary are in it.
    let row = capture(html, /(<a href="\/admin\/posts\/[^/]+\/edit" class="post-row">[^]*?<\/a>)/)
    expect(row).toMatch(
      /<time datetime="[^"]+">[^<]+<\/time> · \w+<\/p><p class="post-summary" data-ignore>/,
    )
  })

  it('says when there are no posts', async () => {
    await app.run(
      Effect.flatMap(SqlClient.SqlClient, (sql) => sql`delete from posts`).pipe(Effect.orDie),
    )
    let html = await (await app.adminFetch('/admin/posts')).text()
    expect(html).toContain('No posts yet.')
    expect(html).not.toContain('class="post-list"')
  })
})
