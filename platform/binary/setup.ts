// `logspace setup`: installs LogSpace on a Linux server, as root: the binary at
// /usr/local/bin/logspace, a systemd service that runs it, and blocks in Caddy's config for the
// site's domain and any domains that should redirect to it:
//
//   sudo ./logspace setup example.com www.example.com
//
// The domains are saved, so later runs (like the one after `logspace upgrade`) can leave them
// out. Existing Caddy site blocks for these domains are replaced. The app's port is PORT in the
// env file (44100 when it isn't set), which Caddy is pointed at, so run it again after changing
// it.
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { promptAdminPassword } from './admin-password.ts'
import { addSite } from './caddyfile.ts'
import { CommandError, IS_BINARY, requireRoot, run, VERSION } from './command.ts'
import { ENV_FILE, readEnvFile, setEnvVariable } from './env-file.ts'

export const BINARY_PATH = '/usr/local/bin/logspace'
export const DOMAINS_FILE = '/etc/logspace.domains'
export const SERVER_DATABASE_PATH = '/var/lib/logspace/app.sqlite'
const SERVICE_FILE = '/etc/systemd/system/logspace.service'
const CADDYFILE = '/etc/caddy/Caddyfile'
const DEFAULT_PORT = 44100

const SERVICE = `[Unit]
Description=LogSpace
After=network.target

[Service]
# logspace setup installs the binary there.
ExecStart=${BINARY_PATH} start
# The default port, which PORT in ${ENV_FILE} overrides (EnvironmentFile= wins over
# Environment=). logspace setup points Caddy at the same one.
Environment=PORT=${DEFAULT_PORT}
Environment=TRUST_PROXY=1
# The SQLite database, media, and caches live in folders systemd creates before the service starts
# (StateDirectory, CacheDirectory), which the app runs in.
StateDirectory=logspace
CacheDirectory=logspace
WorkingDirectory=/var/lib/logspace
Environment=DATABASE_PATH=${SERVER_DATABASE_PATH}
# Media (post photos and videos, and the site's logo and icon), uploaded at /admin, is kept there
# too, in file storage.
Environment=MEDIA_STORAGE=fs
Environment=MEDIA_DIR=/var/lib/logspace/media
# Link previews, and the copy of the binary's public files it serves.
Environment=CACHE_DIR=/var/cache/logspace
# Secrets (ADMIN_PASSWORD, AUTH_SESSION_SECRET) and PORT, readable only by root. logspace setup
# creates it.
EnvironmentFile=${ENV_FILE}
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
`

export async function setup(args: string[]): Promise<void> {
  if (process.platform !== 'linux') {
    throw new CommandError('setup installs LogSpace on a Linux server, with systemd')
  }
  if (!IS_BINARY) throw new CommandError('setup installs the built binary: run it from there')
  requireRoot()

  let domains = args.length > 0 ? args : savedDomains()
  if (!domains) {
    throw new CommandError(
      "Give the site's domain, then any that should redirect to it, " +
        'e.g. logspace setup example.com www.example.com',
    )
  }
  for (let domain of domains) {
    if (!/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(domain)) {
      throw new CommandError(`Not a domain: ${domain}`)
    }
  }
  // Checked before anything's changed.
  try {
    run('caddy', 'version')
  } catch {
    throw new CommandError("Caddy isn't installed: https://caddyserver.com/docs/install")
  }

  createEnvFile()
  let env = readEnvFile()
  let port = env.get('PORT') || String(DEFAULT_PORT)
  if (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535) {
    throw new CommandError(`Not a port: PORT=${port} in ${ENV_FILE}`)
  }
  console.log(`The app listens on port ${port}`)
  if (!env.get('ADMIN_PASSWORD') && process.stdin.isTTY) {
    console.log('Choose a password for /admin, at least 16 characters long.')
    setEnvVariable('ADMIN_PASSWORD', await promptAdminPassword())
  }

  installBinary()
  console.log('Installing logspace.service...')
  fs.writeFileSync(SERVICE_FILE, SERVICE)
  fs.chmodSync(SERVICE_FILE, 0o644)
  run('systemctl', 'daemon-reload')
  run('systemctl', 'enable', '--quiet', 'logspace')
  run('systemctl', 'restart', 'logspace')

  updateCaddyfile(domains, Number(port))
  fs.writeFileSync(DOMAINS_FILE, `${domains.join(' ')}\n`)

  console.log(`Done: LogSpace ${VERSION} is at https://${domains[0]}`)
  if (!readEnvFile().get('ADMIN_PASSWORD')) {
    console.log('Set the password for /admin with: sudo logspace set-admin-password')
  }
}

function savedDomains(): string[] | undefined {
  if (!fs.existsSync(DOMAINS_FILE)) return undefined
  let domains = fs.readFileSync(DOMAINS_FILE, 'utf8').split(/\s+/).filter(Boolean)
  return domains.length > 0 ? domains : undefined
}

// Created once, with a random session secret and the default port.
function createEnvFile() {
  if (fs.existsSync(ENV_FILE)) {
    fs.chmodSync(ENV_FILE, 0o600)
    return
  }
  console.log(`Creating ${ENV_FILE}...`)
  let secret = crypto.randomBytes(32).toString('base64')
  let env = `ADMIN_PASSWORD=\nAUTH_SESSION_SECRET=${secret}\nPORT=${DEFAULT_PORT}\n`
  fs.writeFileSync(ENV_FILE, env, { mode: 0o600, flag: 'wx' })
}

// Copies this binary to BINARY_PATH, unless it's the one there. It's copied beside it and moved
// into place, so a running server keeps its copy.
function installBinary() {
  if (
    fs.existsSync(BINARY_PATH) &&
    fs.realpathSync(process.execPath) === fs.realpathSync(BINARY_PATH)
  ) {
    return
  }
  console.log(`Installing LogSpace ${VERSION} at ${BINARY_PATH}...`)
  fs.mkdirSync(path.dirname(BINARY_PATH), { recursive: true })
  let tmp = `${BINARY_PATH}.${process.pid}.tmp`
  fs.copyFileSync(process.execPath, tmp)
  fs.chmodSync(tmp, 0o755)
  fs.renameSync(tmp, BINARY_PATH)
}

// Checks the new Caddyfile before it replaces the live one, and puts the old one back if Caddy
// rejects it on reload.
function updateCaddyfile(domains: string[], port: number) {
  console.log(`Updating ${CADDYFILE}...`)
  let existing = fs.existsSync(CADDYFILE) ? fs.readFileSync(CADDYFILE, 'utf8') : ''
  let result = addSite(existing, { domains, port })
  if (!result.ok) throw new CommandError(result.error)

  let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logspace-caddy-'))
  try {
    let candidate = path.join(dir, 'Caddyfile')
    fs.writeFileSync(candidate, result.caddyfile)
    run('caddy', 'validate', '--config', candidate, '--adapter', 'caddyfile')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }

  let backup = `${CADDYFILE}.bak`
  fs.mkdirSync(path.dirname(CADDYFILE), { recursive: true })
  fs.writeFileSync(backup, existing)
  fs.writeFileSync(CADDYFILE, result.caddyfile)
  fs.chmodSync(CADDYFILE, 0o644)
  try {
    run('systemctl', 'reload-or-restart', 'caddy')
  } catch (error) {
    fs.writeFileSync(CADDYFILE, existing)
    let reason = error instanceof Error ? error.message : String(error)
    throw new CommandError(`Caddy didn't take the new config, so the old one is back. ${reason}`)
  }
  console.log(`The previous Caddyfile is in ${backup}`)
}
