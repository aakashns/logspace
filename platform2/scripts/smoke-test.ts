// Runs a built binary as a server would, in an empty folder with no node_modules, and checks what
// needs its embedded files: migrations, pages, Datastar, and sharp (resizing a photo, and making
// the icons from an uploaded image).
//
//   bun scripts/smoke-test.ts dist/logspace
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

const binary = path.resolve(process.argv[2] ?? 'dist/logspace')
const PORT = 44298
const base = `http://localhost:${PORT}`
const photo = path.join(import.meta.dir, '../test/content/posts/t83tytis1i/cover.jpg')
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'logspace-smoke-'))

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Smoke test failed: ${message}`)
  console.log(`ok - ${message}`)
}

let version = Bun.spawnSync([binary, 'version']).stdout.toString().trim()
check(/^\d+\.\d+\.\d+$/.test(version), `logspace version prints ${version}`)

let server = Bun.spawn([binary, 'start'], {
  cwd: dir,
  env: {
    ...process.env,
    PORT: String(PORT),
    ADMIN_PASSWORD: 'smoke-password-1234',
    AUTH_SESSION_SECRET: 'smoke-session-secret',
  },
  stdout: 'inherit',
  stderr: 'inherit',
})
try {
  for (let i = 0; ; i++) {
    if ((await fetch(`${base}/admin/login`).catch(() => null))?.ok) break
    if (i > 500) throw new Error('The server didn’t start')
    await Bun.sleep(20)
  }
  check(
    (await fetch(base, { redirect: 'manual' })).status === 302,
    'an unconfigured site sends visitors to the login',
  )

  let login = await fetch(`${base}/admin/login`, {
    method: 'POST',
    body: new URLSearchParams({ password: 'smoke-password-1234' }),
    redirect: 'manual',
  })
  let cookie = login.headers.getSetCookie()[0]?.split(';')[0] ?? ''
  check(login.status === 302 && cookie.startsWith('admin_session='), 'the admin logs in')

  let config = new FormData()
  for (let [name, value] of Object.entries({
    siteTitle: 'Smoke',
    siteUrl: base,
    siteDescription: 'A test',
    heroHeading: '',
    heroSubheading: '',
    socialImageAlt: '',
  })) {
    config.set(name, value)
  }
  config.set('icon', Bun.file(photo), 'icon.jpg')
  let saved = await fetch(`${base}/admin/config`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: config,
    redirect: 'manual',
  })
  check(saved.status === 303, 'the settings save, with an icon made by sharp')
  let favicon = await fetch(`${base}/favicon.ico`)
  check(favicon.headers.get('Content-Type') === 'image/x-icon', 'the favicon is served')

  let post = new FormData()
  for (let [name, value] of Object.entries({
    id: 'smoketest1',
    type: 'photos',
    date: '2026-10-23T10:00',
    offset: '+05:30',
    caption: 'Hello',
    photo_file: '',
    photo_alt: 'A photo',
  })) {
    post.set(name, value)
  }
  post.set('photo_upload', Bun.file(photo), 'cover.jpg')
  let published = await fetch(`${base}/admin/posts/new`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: post,
    redirect: 'manual',
  })
  check(published.status === 303, 'a photos post is published with an upload')

  let html = await (await fetch(base)).text()
  check(html.includes('Hello'), 'the home page shows it')
  let datastar = html.match(/src="(\/assets\/datastar\.[0-9a-f]+\.js)"/)?.[1]
  check(datastar && (await fetch(base + datastar)).ok, 'Datastar is served')
  let resized = html.match(/srcset="([^" ]+)/)?.[1].replaceAll('&amp;', '&')
  let webp = resized ? await fetch(base + resized) : undefined
  check(webp?.headers.get('Content-Type') === 'image/webp', 'a resized copy is made by sharp')
} finally {
  server.kill()
  await server.exited
  await fs.rm(dir, { recursive: true, force: true })
}
