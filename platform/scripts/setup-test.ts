// Checks `logspace setup` and `logspace set-admin-password` on a Linux machine with systemd and
// Caddy, as a user with passwordless sudo. It sets the machine up for real, replacing Caddy's
// config, so only run it on a throwaway one.
//
//   bun scripts/setup-test.ts dist/logspace
import * as fs from 'node:fs'
import * as path from 'node:path'

import { $ } from 'bun'

if (!process.argv[2]) {
  console.error('Usage: bun scripts/setup-test.ts <binary>')
  process.exit(1)
}
const BINARY = path.resolve(process.argv[2])
const INSTALLED = '/usr/local/bin/logspace'
const CADDYFILE = '/etc/caddy/Caddyfile'
// Caddy gives *.localhost sites certificates from its own authority, and curl's --resolve sends
// them to this machine.
const DOMAIN = 'logspace.localhost'
const REDIRECT = 'www.logspace.localhost'
const PASSWORD = 'setup-test-password'

function fail(message: string): never {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}

function ok(message: string) {
  console.log(`ok ${message}`)
}

async function expectRun(
  command: ReturnType<typeof $>,
  description: string,
  status: number,
  output: RegExp,
) {
  let result = await command.nothrow().quiet()
  let text = `${result.stdout}${result.stderr}`
  if (result.exitCode !== status || !output.test(text)) {
    fail(`${description} exited with ${result.exitCode}:\n${text}`)
  }
  ok(description)
  return text
}

// "<status> <redirect URL>" for an HTTPS request to the site through Caddy, once it's that (the app
// takes a moment to start, and Caddy to issue a certificate).
async function expectHttps(url: string, want: string, ...args: string[]) {
  let host = new URL(url).hostname
  let got = ''
  for (let i = 0; i < 30; i++) {
    got = (
      await $`curl -sk --resolve ${host}:443:127.0.0.1 -o /dev/null -w ${'%{http_code} %{redirect_url}'} ${args} ${url}`
        .nothrow()
        .quiet()
    ).stdout
      .toString()
      .trim()
    if (got === want) return ok(`${url} -> ${want}`)
    await Bun.sleep(1000)
  }
  fail(`expected "${want}", got "${got}": ${url}`)
}

async function sudoRead(file: string) {
  return (await $`sudo cat ${file}`.quiet()).stdout.toString()
}

if (fs.existsSync('/etc/logspace.domains')) {
  fail('LogSpace is set up on this machine already. Run this on a fresh one.')
}
let initial = `other.localhost {\n\trespond "other"\n}\n\n${DOMAIN} {\n\trespond "old"\n}\n`
await $`sudo tee ${CADDYFILE} < ${new Response(initial)}`.quiet()
await $`sudo systemctl reload-or-restart caddy`

// Where install.sh puts it.
await $`sudo install -m 755 ${BINARY} ${INSTALLED}`

// Simulate the previous root-run service's state before installing the hardened unit.
await $`sudo mkdir -p /var/lib/logspace/media/legacy /var/cache/logspace`
await $`sudo env DATABASE_PATH=/var/lib/logspace/app.sqlite ${INSTALLED} migrate`.quiet()
await $`sudo tee /var/lib/logspace/media/legacy/kept.txt < ${new Response('existing data')}`.quiet()
await $`sudo chmod 600 /var/lib/logspace/media/legacy/kept.txt`

console.log('--- setup')
await expectRun($`${BINARY} setup ${DOMAIN}`, 'setup as a user', 1, /Run it as root/)
await expectRun($`sudo ${BINARY} setup`, 'setup without domains', 1, /Give the site's domain/)
await expectRun($`sudo ${BINARY} setup ${'bad_domain!'}`, 'setup a bad domain', 1, /Not a domain/)
let output = await expectRun(
  $`sudo ${INSTALLED} setup ${DOMAIN} ${REDIRECT} < /dev/null`,
  `setup ${DOMAIN} ${REDIRECT}`,
  0,
  /Set the password for \/admin with/,
)
let unit = fs.readFileSync('/etc/systemd/system/logspace.service', 'utf8')
if (!unit.includes(`\nExecStart=${fs.realpathSync(INSTALLED)} start\n`))
  fail(`the service doesn't run ${INSTALLED}`)
if ((await $`systemctl is-active logspace`.nothrow().text()).trim() !== 'active') {
  fail(`the service isn't running:\n${await $`sudo journalctl -u logspace -n 50`.text()}`)
}
ok('service running')
await expectRun(
  $`sudo systemd-analyze verify /etc/systemd/system/logspace.service`,
  'unit verifies',
  0,
  /(?:)/,
)
let pid = (await $`systemctl show logspace -p MainPID --value`.text()).trim()
let uid = (await $`ps -o uid= -p ${pid}`.text()).trim()
if (uid === '0' || !/^\d+$/.test(uid)) fail(`server uid must be nonzero: ${uid}`)
let status = await sudoRead(`/proc/${pid}/status`)
if (!/^NoNewPrivs:\s+1$/m.test(status) || !/^CapEff:\s+0+$/m.test(status))
  fail('privileges not restricted')
ok(`server uid=${uid}, NoNewPrivs=1, CapEff=0`)
let listeners = (await $`sudo ss -ltnp`.text())
  .split('\n')
  .filter((line) => line.includes(':44100'))
if (listeners.length !== 1 || !listeners[0]?.includes('127.0.0.1:44100'))
  fail(`unexpected listeners: ${listeners}`)
ok('only 127.0.0.1:44100 is listening')
await expectRun(
  $`sudo nsenter -t ${pid} -m --setuid ${uid} --setgid ${uid} /bin/sh -c ${'test ! -r /etc/logspace.env && touch /var/lib/logspace/media/sandbox-probe && touch /var/cache/logspace/sandbox-probe && ! touch /etc/logspace-probe && ! touch /usr/local/bin/logspace-probe'}`,
  'sandbox permits state/cache writes and denies secrets/system writes',
  0,
  /(?:)/,
)

if ((await $`sudo stat -c %u /var/lib/logspace/media/legacy/kept.txt`.text()).trim() === '0')
  fail('old media is still root-owned')
if ((await sudoRead('/var/lib/logspace/media/legacy/kept.txt')) !== 'existing data')
  fail('old media changed')
ok('existing root-owned state is preserved and transferred')

if ((await $`sudo stat -c %a /etc/logspace.env`.text()).trim() !== '600') {
  fail("the env file isn't root-only")
}
let secret = /^AUTH_SESSION_SECRET=(.*)$/m.exec(await sudoRead('/etc/logspace.env'))?.[1] ?? ''
if (secret.length < 16) fail('there is no session secret')
ok('env file')

let caddyfile = fs.readFileSync(CADDYFILE, 'utf8')
if (!caddyfile.includes('respond "other"') || caddyfile.includes('respond "old"')) {
  fail(`the other site's block should be kept, and the old one replaced:\n${caddyfile}`)
}
await expectHttps(`https://${DOMAIN}/admin/login`, '200')
await expectHttps(`https://${DOMAIN}/`, `302 https://${DOMAIN}/admin/login`)
await expectHttps(`https://${REDIRECT}/a?b=1`, `301 https://${DOMAIN}/a?b=1`)
await expectHttps('https://other.localhost/', '200')

await expectRun(
  $`sudo ${INSTALLED} migrate --dry-run`,
  "migrate the service's database",
  0,
  /\/var\/lib\/logspace\/app\.sqlite has no migrations to apply/,
)

console.log('--- set-admin-password')
let setPassword = (input: string) => $`sudo ${BINARY} set-admin-password < ${new Response(input)}`
await expectRun(setPassword(`${PASSWORD}\nanother\n`), 'mismatched', 1, /don't match/)
await expectRun(setPassword('short\nshort\n'), 'too short', 1, /at least 16 characters/)
await expectRun(setPassword(`"${PASSWORD}"\n"${PASSWORD}"\n`), 'quoted', 1, /without quotes/)
await expectRun(setPassword(`${PASSWORD}\n${PASSWORD}\n`), 'set-admin-password', 0, /updated/)
let login = ['-H', `Origin: https://${DOMAIN}`, '-d', `password=${PASSWORD}`]
await expectHttps(`https://${DOMAIN}/admin/login`, `302 https://${DOMAIN}/admin`, ...login)

// Real writes under the service sandbox: credentials loaded by PID 1, SQLite/WAL, icon
// generation, post media, and resized copies through Caddy.
let loginHeaders =
  await $`curl -sk --resolve ${DOMAIN}:443:127.0.0.1 -D - -o /dev/null -d ${`password=${PASSWORD}`} ${`https://${DOMAIN}/admin/login`}`.text()
let cookie = /^set-cookie: (admin_session=[^;]+)/im.exec(loginHeaders)?.[1]
if (!cookie) fail('login did not set a session cookie')
let auth = ['-H', `Cookie: ${cookie}`, '-H', `Origin: https://${DOMAIN}`]
let icon = path.resolve(import.meta.dir, '../src/services/default-icon.png')
await expectHttps(
  `https://${DOMAIN}/admin/config`,
  `303 https://${DOMAIN}/admin/config`,
  ...auth,
  '-F',
  'siteTitle=Setup test',
  '-F',
  `siteUrl=https://${DOMAIN}`,
  '-F',
  'siteDescription=Test',
  '-F',
  'heroHeading=',
  '-F',
  'heroSubheading=',
  '-F',
  'bannerImageAlt=',
  '-F',
  `icon=@${icon}`,
)
let photo = path.resolve(import.meta.dir, '../test/content/posts/t83tytis1i/cover.jpg')
await expectHttps(
  `https://${DOMAIN}/admin/posts/new`,
  `303 https://${DOMAIN}/posts/setup00001`,
  ...auth,
  '-F',
  'post_id=setup00001',
  '-F',
  'caption=Sandbox writes',
  '-F',
  `image_uploads=@${photo}`,
)
await expectHttps(`https://${DOMAIN}/posts/setup00001/cover.jpg`, '200')
let version = new Bun.CryptoHasher('sha256')
  .update(fs.readFileSync(photo))
  .digest('hex')
  .slice(0, 12)
await expectHttps(`https://${DOMAIN}/posts/setup00001/cover.jpg?w=600&v=${version}`, '200')
await expectHttps(`https://${DOMAIN}/site/icon-512.png`, '200')
await expectHttps(
  `https://${DOMAIN}/admin/posts/new`,
  `303 https://${DOMAIN}/posts/setuplink1`,
  ...auth,
  '-F',
  'id=setuplink1',
  '-F',
  'caption=http://127.0.0.1/private-preview-probe',
)
await expectHttps(`https://${DOMAIN}/`, '200')
await expectRun(
  $`sudo test -f /var/cache/logspace/link-previews.json`,
  'preview cache writes under sandbox',
  0,
  /(?:)/,
)
await expectRun($`sudo test -f /var/lib/logspace/app.sqlite-wal`, 'SQLite WAL exists', 0, /(?:)/)
await expectHttps(
  `https://${DOMAIN}/admin/logout`,
  `302 https://${DOMAIN}/admin/login`,
  ...auth,
  '-X',
  'POST',
)
await expectHttps(`https://${DOMAIN}/admin`, `302 https://${DOMAIN}/admin/login`, ...auth)

console.log('--- setup again, on another port')
await $`sudo sed -i ${'s/^PORT=.*/PORT=44105/'} /etc/logspace.env`
output = await expectRun($`sudo ${INSTALLED} setup`, 'setup with the saved domains', 0, /Done/)
if (output.includes('set-admin-password')) fail('it lost the admin password')
caddyfile = fs.readFileSync(CADDYFILE, 'utf8')
let siteBlocks = caddyfile.split('\n').filter((line) => line === `${DOMAIN} {`)
if (siteBlocks.length !== 1 || !caddyfile.includes('127.0.0.1:44105')) {
  fail(`the site's block should be replaced:\n${caddyfile}`)
}
if (!(await sudoRead('/etc/logspace.env')).includes(`AUTH_SESSION_SECRET=${secret}\n`)) {
  fail('the session secret changed')
}
await expectHttps(`https://${DOMAIN}/admin/login`, `302 https://${DOMAIN}/admin`, ...login)
await expectHttps(`https://${DOMAIN}/posts/setup00001/cover.jpg`, '200')
await expectHttps(`https://${DOMAIN}/site/icon-512.png`, '200')

console.log('--- refuse incompatible existing environment without replacing the service')
let previousUnit = fs.readFileSync('/etc/systemd/system/logspace.service', 'utf8')
await $`sudo tee -a /etc/logspace.env < ${new Response('HOST=0.0.0.0\n')}`.quiet()
await expectRun($`sudo ${INSTALLED} setup`, 'unsafe listener override', 1, /HOST must be 127.0.0.1/)
if (fs.readFileSync('/etc/systemd/system/logspace.service', 'utf8') !== previousUnit)
  fail('unsafe setup changed the unit')
await $`sudo sed -i '/^HOST=/d' /etc/logspace.env`
await expectHttps(`https://${DOMAIN}/posts/setup00001/cover.jpg`, '200')

console.log('--- a block that mixes the domains with others')
let mixedBlock = `\n${REDIRECT}, mixed.localhost {\n}\n`
await $`sudo tee -a ${CADDYFILE} < ${new Response(mixedBlock)}`.quiet()
let mixed = fs.readFileSync(CADDYFILE, 'utf8')
await expectRun($`sudo ${INSTALLED} setup`, 'setup', 1, /edit it by hand/)
if (fs.readFileSync(CADDYFILE, 'utf8') !== mixed) fail('it changed the Caddyfile')

console.log('All good')
