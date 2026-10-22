// Checks that a built binary works on this machine. It checks its commands, then runs the server
// from an empty folder, behind a pretend reverse proxy, logs in, configures the site, publishes a
// photos post, and fetches the pages, assets, and images sharp makes. Then it does the same with
// media in a pretend S3 bucket that's slow to send files (fake-s3.ts), and last, it upgrades a
// copy of the binary from pretend releases. CI runs it on every binary it releases.
//
//   bun binary/smoke-test.ts dist/logspace
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Subprocess } from 'bun'

import packageJson from '../package.json' with { type: 'json' }
import { startFakeS3 } from './fake-s3.ts'

if (!process.argv[2]) {
  console.error('Usage: bun binary/smoke-test.ts <binary>')
  process.exit(1)
}
const BINARY = path.resolve(process.argv[2])
const PHOTO = fileURLToPath(new URL('../test/content/posts/drdp3ei6fd/hike-1.jpg', import.meta.url))
const PORT = Number(process.env.SMOKE_TEST_PORT || 44190)
const S3_PORT = PORT + 1
const RELEASES_PORT = PORT + 2
// Longer than Bun's default idle timeout (10 seconds), which closed connections like these.
const S3_DELAY = 12
const ORIGIN = 'https://logspace.test'
const BASE = `http://127.0.0.1:${PORT}`
const PASSWORD = 'smoke-test-password'

let work = fs.mkdtempSync(path.join(os.tmpdir(), 'logspace-smoke-test-'))
let server: Subprocess | undefined
let log: string | undefined
process.on('exit', () => {
  server?.kill()
  fs.rmSync(work, { recursive: true, force: true })
})

function fail(message: string): never {
  console.error(`FAIL: ${message}`)
  if (log) console.error(`--- server log\n${fs.readFileSync(log, 'utf8')}`)
  process.exit(1)
}

function ok(message: string) {
  console.log(`ok ${message}`)
}

// Runs the binary (or a copy of it) to completion. It's async, so the pretend releases this
// process serves can answer it.
async function cli(
  args: string[],
  { binary = BINARY, env = {} as Record<string, string>, cwd = work } = {},
) {
  let child = Bun.spawn([binary, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  let [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { status, stdout, stderr, output: `${stdout}${stderr}` }
}

async function expectCli(
  args: string[],
  status: number,
  output: RegExp,
  {
    label = `logspace ${args.join(' ')}`,
    ...options
  }: Parameters<typeof cli>[1] & { label?: string } = {},
) {
  let result = await cli(args, options)
  if (result.status !== status || !output.test(result.output)) {
    fail(`${label} exited with ${result.status}:\n${result.output}`)
  }
  ok(label)
  return result
}

// Requests as they'd come through the proxy for ORIGIN, with the admin session once there is one.
let session = ''
function request(url: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  return fetch(`${BASE}${url}`, {
    redirect: 'manual',
    ...init,
    headers: {
      'X-Forwarded-Proto': 'https',
      'X-Forwarded-Host': 'logspace.test',
      ...(session ? { Cookie: session } : {}),
      ...init.headers,
    },
  })
}

async function expect(status: number, url: string) {
  let response = await request(url)
  await response.arrayBuffer()
  if (response.status !== status) fail(`expected ${status}, got ${response.status}: ${url}`)
  ok(`${status} ${url}`)
}

async function text(url: string) {
  return (await request(url)).text()
}

// Form posts carry the proxy's origin, which cop() checks against the forwarded URL's host
// (there's no Sec-Fetch-Site for it to go by), and each is answered with a redirect once it's done.
async function post(url: string, fields: Record<string, string | File>) {
  let body = new FormData()
  for (let [name, value] of Object.entries(fields)) body.append(name, value)
  let response = await request(url, { method: 'POST', headers: { Origin: ORIGIN }, body })
  await response.arrayBuffer()
  if (response.status !== 302 && response.status !== 303) {
    fail(`expected a redirect, got ${response.status}: POST ${url}`)
  }
  ok(`POST ${url}`)
}

// Starts the server in its own empty folder, with the args and any extra settings given, and
// without NODE_ENV, which its environment needn't have.
async function start(name: string, args: string[], env: Record<string, string> = {}) {
  let dir = path.join(work, name)
  fs.mkdirSync(dir, { recursive: true })
  log = path.join(dir, 'server.log')
  let output = fs.openSync(log, 'a')
  let { NODE_ENV: _, ...inherited } = process.env
  server = Bun.spawn([BINARY, ...args], {
    cwd: dir,
    env: {
      ...inherited,
      PORT: String(PORT),
      TRUST_PROXY: '1',
      ADMIN_PASSWORD: PASSWORD,
      AUTH_SESSION_SECRET: 'smoke-test-secret',
      ...env,
    },
    stdout: output,
    stderr: output,
  })
  session = ''
  for (let i = 0; i < 50; i++) {
    if (fs.readFileSync(log, 'utf8').includes('Server listening')) return
    if (server.exitCode !== null) break
    await Bun.sleep(200)
  }
  fail(`the server didn't start`)
}

async function stop() {
  server?.kill()
  await server?.exited
  server = undefined
}

function checkLog() {
  if (log && /error/i.test(fs.readFileSync(log, 'utf8'))) fail('the server logged errors')
}

// Logs in, configures the site, and publishes a photos post.
async function publish() {
  let login = await request('/admin/login', {
    method: 'POST',
    headers: { Origin: ORIGIN },
    body: new URLSearchParams({ password: PASSWORD }),
  })
  // Sent by hand from here on: fetch keeps a Secure cookie to itself over plain HTTP.
  session =
    login.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .find((cookie) => cookie.startsWith('admin_session=')) ?? ''
  if (!session) fail("couldn't log in")
  ok('logged in')
  await post('/admin/config', {
    siteTitle: 'Smoke Test',
    siteUrl: ORIGIN,
    siteDescription: 'A smoke test.',
    heroHeading: '',
    heroSubheading: '',
    socialImageAlt: '',
  })
  await post('/admin/posts/new', {
    id: 'smoketest1',
    type: 'photos',
    date: '2026-10-22T09:30',
    offset: '+05:30',
    caption: '',
    photo_file: '',
    photo_alt: 'Hike',
    photo_width: '',
    photo_height: '',
    photo_upload: new File([fs.readFileSync(PHOTO)], 'hike-1.jpg', { type: 'image/jpeg' }),
  })
}

console.log(`${(await cli(['version'])).stdout.trim()} on ${os.platform()} ${os.arch()}`)

console.log('--- commands')
let version = new RegExp(`^${packageJson.version.replaceAll('.', '\\.')}\n$`)
for (let args of [['version'], ['--version'], ['-v']]) await expectCli(args, 0, version)
for (let args of [['help'], ['--help'], ['-h']]) await expectCli(args, 0, /^Usage: logspace/m)
await expectCli(['bogus'], 1, /^Unknown command: bogus/)
await expectCli(['version', 'extra'], 1, /^Error: Unexpected arguments: extra/)

console.log('--- migrate')
// The database the server below starts with.
let local = { cwd: path.join(work, 'local') }
fs.mkdirSync(local.cwd)
let migrations = fs.readdirSync(new URL('../db/migrations/', import.meta.url)).length
await expectCli(['migrate', '--dry-run'], 1, /There's no database at .*data\/app\.sqlite/, local)
let applied = await expectCli(['migrate'], 0, /^Applied to .*data\/app\.sqlite:/, local)
if (applied.stdout.match(/^  \d{4}_/gm)?.length !== migrations) {
  fail(`migrate should apply ${migrations} migrations:\n${applied.stdout}`)
}
await expectCli(['migrate'], 0, /has no migrations to apply/, local)
await expectCli(['migrate', '--dry-run'], 0, /has no migrations to apply/, local)

console.log('--- media in a folder')
await start('local', [])

// Before the site is configured, pages lead to the login, but the icons (drawn from LogSpace's
// SVG mark by sharp) and public/ are there.
await expect(302, '/')
await expect(200, '/admin/login')
await expect(200, '/favicon.ico')
await expect(200, '/apple-touch-icon.png')
await expect(200, '/fonts/instrument-sans-latin-ext-600.woff2')
await expect(404, '/assets/missing.js')

// Every script the page loads (fingerprinted URLs; the import map's keys are only names) is served,
// with a year's cache.
let scripts = [...new Set((await text('/admin/login')).match(/\/assets\/[^"]*\.@[^"]*/g))]
if (scripts.length === 0) fail('the login page loads no scripts')
for (let script of scripts) {
  let response = await request(script)
  await response.arrayBuffer()
  if (response.status !== 200) fail(`couldn't load ${script}`)
}
ok(`${scripts.length} scripts`)
let cacheControl = (await request(scripts[0])).headers.get('Cache-Control') ?? ''
if (!cacheControl.includes('immutable')) fail("scripts aren't cached")

// The forwarded URL, from either kind of header: the standard Forwarded header passes cop()'s check
// on its own, and the config form suggests the forwarded origin as the site's URL.
let forwarded = await fetch(`${BASE}/admin/login`, {
  method: 'POST',
  redirect: 'manual',
  headers: { Forwarded: 'for=192.0.2.1;proto=https;host=logspace.test', Origin: ORIGIN },
  body: new URLSearchParams({ password: PASSWORD }),
})
if (forwarded.status !== 302) {
  fail(`a login through a proxy that sends Forwarded got ${forwarded.status}`)
}
await publish()
if (!(await text('/admin/config')).includes(`value="${ORIGIN}"`)) {
  fail("the request's URL isn't the forwarded one")
}
ok('forwarded URL')

await expect(200, '/')
await expect(200, '/rss.xml')
await expect(200, '/posts/smoketest1')
// A resized WebP copy of the photo, made by sharp.
let variant = (await text('/posts/smoketest1'))
  .match(/\/posts\/smoketest1\/hike-1\.jpg\?w=[^" ]*/)?.[0]
  .replaceAll('&amp;', '&')
if (!variant) fail('the post has no resized photos')
let resized = await request(variant)
await resized.arrayBuffer()
if (resized.headers.get('Content-Type') !== 'image/webp') fail("the resized photo isn't WebP")
ok(`resized ${variant}`)
checkLog()

// An error is answered with a plain 500, not Bun's development page with the stack and code.
let broken = await request('/admin/login', {
  method: 'POST',
  headers: { 'Content-Type': 'multipart/form-data' },
  body: 'broken',
})
let errorPage = await broken.text()
if (broken.status !== 500) fail(`a broken form got ${broken.status}, not 500`)
if (errorPage.includes('bunfallback') || errorPage.length > 100) {
  fail(`an error's page shows too much: ${errorPage.slice(0, 300)}`)
}
ok(`plain error page: ${errorPage}`)
await stop()

console.log(`--- media in S3, which takes ${S3_DELAY}s to send a file`)
let s3 = await startFakeS3(S3_PORT, S3_DELAY)
await start('s3', ['start'], {
  MEDIA_STORAGE: 's3',
  MEDIA_S3_BUCKET: 'media',
  MEDIA_S3_REGION: 'auto',
  MEDIA_S3_ENDPOINT: `http://127.0.0.1:${S3_PORT}`,
  MEDIA_S3_ACCESS_KEY_ID: 'key',
  MEDIA_S3_SECRET_ACCESS_KEY: 'secret',
})
await publish()
let photoUrl = (await text('/posts/smoketest1')).match(/\/posts\/smoketest1\/hike-1\.jpg\?v=[^"&]*/)
if (!photoUrl) fail('the post has no photo')
let photo = await request(photoUrl[0])
  .then((response) => response.arrayBuffer())
  .catch(() => fail('the connection closed while S3 was sending the photo'))
if (!Buffer.from(photo).equals(fs.readFileSync(PHOTO)))
  fail("the photo from S3 isn't the one uploaded")
ok('photo from slow S3')
checkLog()
await stop()
s3.close()

console.log('--- install and upgrade from pretend releases')
// Each release's binary is this one, and 99.0.1's SHA256SUMS has the wrong hash for it.
let asset = `logspace-${process.platform}-${process.arch}`
let bytes = fs.readFileSync(BINARY)
let hash = crypto.createHash('sha256').update(bytes).digest('hex')
let releases = new Map([
  [packageJson.version, hash],
  ['99.0.0', hash],
  ['99.0.1', '0'.repeat(64)],
])
let latest = packageJson.version
let releaseServer = Bun.serve({
  port: RELEASES_PORT,
  hostname: '127.0.0.1',
  fetch(req) {
    let url = new URL(req.url)
    if (url.pathname === '/releases/latest') {
      return Response.redirect(new URL(`/releases/tag/v${latest}`, url), 302)
    }
    let [, version, file] =
      /^\/releases\/(?:download\/v([^/]+)|latest\/download)\/(.+)$/.exec(url.pathname) ?? []
    version ??= latest
    let sum = releases.get(version)
    if (sum && file === 'SHA256SUMS') return new Response(`${sum}  ${asset}\n`)
    if (sum && file === asset) return new Response(bytes)
    return new Response('Not found', { status: 404 })
  },
})
let releasesUrl = `http://127.0.0.1:${RELEASES_PORT}/releases`

// install.sh, into a folder of its own.
let copy = path.join(work, 'bin', 'logspace')
let install = (label: string, env: Record<string, string> = {}) => ({
  binary: 'sh',
  label,
  env: { LOGSPACE_RELEASES_URL: releasesUrl, LOGSPACE_INSTALL_DIR: path.dirname(copy), ...env },
})
let installer = fileURLToPath(new URL('../../install.sh', import.meta.url))
let installed = new RegExp(`Installed LogSpace ${packageJson.version.replaceAll('.', '\\.')} at `)
await expectCli([installer], 0, installed, install('install.sh'))
await expectCli([installer], 0, installed, install('install.sh again'))
let inode = fs.statSync(copy).ino
await expectCli([installer], 1, /doesn't match its checksum/, {
  ...install('install.sh with a bad checksum', { LOGSPACE_VERSION: '99.0.1' }),
})
await expectCli([installer], 1, /couldn't download/, {
  ...install('install.sh a missing version', { LOGSPACE_VERSION: 'v99.0.2' }),
})
if (fs.statSync(copy).ino !== inode) fail('a failed install replaced the binary')
if (fs.readdirSync(path.dirname(copy)).length !== 1) fail('install.sh left files behind')

let options = { binary: copy, env: { LOGSPACE_RELEASES_URL: releasesUrl } }
await expectCli(['upgrade'], 0, /is up to date/, options)
await expectCli(['upgrade', '0.0.1', '--yes'], 1, /is older than/, options)
await expectCli(['upgrade', 'v99.0.1', '--yes'], 1, /doesn't match 99\.0\.1's SHA256SUMS/, options)
await expectCli(['upgrade', '99.0.2', '--yes'], 1, /HTTP 404/, options)
if (fs.statSync(copy).ino !== inode) fail('a failed upgrade replaced the binary')
latest = '99.0.0'
let upgraded = new RegExp(`Upgraded LogSpace ${packageJson.version} to 99\\.0\\.0`)
await expectCli(['upgrade', '--yes'], 0, upgraded, options)
if (fs.statSync(copy).ino === inode) fail("the upgrade didn't replace the binary")
if (fs.readdirSync(path.dirname(copy)).length !== 1) fail('the upgrade left files behind')
await expectCli(['version'], 0, version, options)
await releaseServer.stop()

console.log('All good')
process.exit(0)
