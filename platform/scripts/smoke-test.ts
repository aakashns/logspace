// Runs a built binary as a server would, in an empty folder with no node_modules, and checks what
// needs its embedded files: migrations, pages, Datastar, the default icon, and Bun.Image (resizing
// a photo, and making the icons from an uploaded image), and the turnstile command on the running
// server's database. Then it installs it with install.sh and upgrades it, from pretend releases.
// CI runs it on every binary it releases.
//
//   bun scripts/smoke-test.ts dist/logspace
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import packageJson from '../package.json' with { type: 'json' }

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
    HOST: undefined,
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
    (await fetch(`http://[::1]:${PORT}/admin/login`)).ok,
    'without HOST, the default listener still accepts IPv6 connections',
  )
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
    bannerImageAlt: '',
  })) {
    config.set(name, value)
  }
  // The icon has to be square.
  let icon = await new Bun.Image(photo).resize(512, 512).png().bytes()
  config.set('icon', new File([new Uint8Array(icon)], 'icon.png', { type: 'image/png' }))
  let saved = await fetch(`${base}/admin/branding`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: config,
    redirect: 'manual',
  })
  check(saved.status === 303, 'the settings save, with an icon made by Bun.Image')
  let favicon = await fetch(`${base}/favicon.ico`)
  check(favicon.headers.get('Content-Type') === 'image/x-icon', 'the favicon is served')

  let post = new FormData()
  post.set('post_id', 'smoketest1')
  post.set('caption', 'Hello')
  post.set('image_uploads', Bun.file(photo), 'cover.jpg')
  let published = await fetch(`${base}/admin/posts`, {
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
  let resized = html.match(/srcset="([^" ]+)/)?.[1]?.replaceAll('&amp;', '&')
  let webp = resized ? await fetch(base + resized) : undefined
  check(webp?.headers.get('Content-Type') === 'image/webp', 'a resized copy is made by Bun.Image')

  // Turnstile, enabled at /admin/integrations (with Cloudflare's test keys), then turned off and
  // on again by the command, against the running server's database.
  let connected = await fetch(`${base}/admin/integrations/turnstile`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: new URLSearchParams({
      siteKey: '1x00000000000000000000AA',
      secretKey: '1x0000000000000000000000000000000AA',
      enabled: 'on',
    }),
    redirect: 'manual',
  })
  let widget = async () =>
    (await (await fetch(`${base}/admin/login`)).text()).includes('class="cf-turnstile"')
  check(connected.status === 303 && (await widget()), 'logging in shows Turnstile once enabled')
  let off = Bun.spawnSync([binary, 'turnstile', 'off'], { cwd: dir })
  check(off.exitCode === 0 && !(await widget()), 'logspace turnstile off turns it off')
  let on = Bun.spawnSync([binary, 'turnstile', 'on'], { cwd: dir })
  check(on.exitCode === 0 && (await widget()), 'logspace turnstile on turns it back on')
} finally {
  server.kill()
  await server.exited
}

// Each pretend release's binary is this one, and 99.0.1's SHA256SUMS has the wrong hash for it.
let asset = `logspace-${process.platform}-${process.arch}`
let bytes = await Bun.file(binary).bytes()
let hash = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
let releases = new Map([
  [packageJson.version, hash],
  ['99.0.0', hash],
  ['99.0.1', '0'.repeat(64)],
])
let latest = packageJson.version
let releaseServer = Bun.serve({
  port: PORT + 1,
  hostname: '127.0.0.1',
  fetch(request) {
    let url = new URL(request.url)
    if (url.pathname === '/releases/latest') {
      return Response.redirect(new URL(`/releases/tag/v${latest}`, url), 302)
    }
    let [, version = latest, file] =
      /^\/releases\/(?:download\/v([^/]+)|latest\/download)\/(.+)$/.exec(url.pathname) ?? []
    let sum = releases.get(version)
    if (sum && file === 'SHA256SUMS') return new Response(`${sum}  ${asset}\n`)
    if (sum && file === asset) return new Response(bytes)
    return new Response('Not found', { status: 404 })
  },
})
let releasesUrl = `http://127.0.0.1:${PORT + 1}/releases`

// Runs a program to completion (asynchronously, so the pretend releases can answer it), and
// checks its exit status and output.
async function expectRun(
  command: string[],
  status: number,
  output: RegExp,
  label: string,
  env: Record<string, string> = {},
) {
  let child = Bun.spawn(command, {
    cwd: dir,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  let text = (await new Response(child.stdout).text()) + (await new Response(child.stderr).text())
  let code = await child.exited
  if (code !== status || !output.test(text)) {
    throw new Error(`Smoke test failed: ${label}: exited ${code} with\n${text}`)
  }
  console.log(`ok - ${label}`)
}

try {
  let copy = path.join(dir, 'bin', 'logspace')
  let installer = path.join(import.meta.dir, '../../website/public/install.sh')
  let installEnv = (env: Record<string, string> = {}) => ({
    LOGSPACE_RELEASES_URL: releasesUrl,
    LOGSPACE_INSTALL_DIR: path.dirname(copy),
    ...env,
  })
  let installed = new RegExp(`Installed LogSpace ${packageJson.version.replaceAll('.', '\\.')} at `)
  await expectRun(['sh', installer], 0, installed, 'install.sh installs it', installEnv())
  await expectRun(['sh', installer], 0, installed, 'install.sh installs it again', installEnv())
  let inode = (await fs.stat(copy)).ino
  await expectRun(
    ['sh', installer],
    1,
    /doesn't match its checksum/,
    'install.sh refuses a bad checksum',
    installEnv({ LOGSPACE_VERSION: '99.0.1' }),
  )
  await expectRun(
    ['sh', installer],
    1,
    /couldn't download/,
    'install.sh says a version is missing',
    installEnv({ LOGSPACE_VERSION: 'v99.0.2' }),
  )
  check((await fs.stat(copy)).ino === inode, 'a failed install leaves the binary alone')

  let env = { LOGSPACE_RELEASES_URL: releasesUrl }
  await expectRun([copy, 'upgrade'], 0, /is up to date/, 'upgrade says it’s up to date', env)
  await expectRun(
    [copy, 'upgrade', '0.0.1', '--yes'],
    1,
    /is older than/,
    'upgrade refuses an older version',
    env,
  )
  await expectRun(
    [copy, 'upgrade', 'v99.0.1', '--yes'],
    1,
    /doesn't match 99\.0\.1's SHA256SUMS/,
    'upgrade refuses a bad checksum',
    env,
  )
  await expectRun(
    [copy, 'upgrade', '99.0.2', '--yes'],
    1,
    /HTTP 404/,
    'upgrade says a version is missing',
    env,
  )
  check((await fs.stat(copy)).ino === inode, 'a failed upgrade leaves the binary alone')
  latest = '99.0.0'
  let upgraded = new RegExp(
    `Upgraded LogSpace ${packageJson.version.replaceAll('.', '\\.')} to 99\\.0\\.0`,
  )
  await expectRun([copy, 'upgrade', '--yes'], 0, upgraded, 'upgrade replaces the binary', env)
  check((await fs.stat(copy)).ino !== inode, 'the upgrade replaced the binary')
  check((await fs.readdir(path.dirname(copy))).length === 1, 'the upgrade left no files behind')
} finally {
  await releaseServer.stop()
  await fs.rm(dir, { recursive: true, force: true })
}
console.log('All good')
