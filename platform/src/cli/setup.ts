// `logspace setup`: sets up a Linux server, as root, to run LogSpace from the binary it's run from
// (which install.sh installs at /usr/local/bin/logspace): a systemd service that runs it, its env
// file, and blocks in Caddy's config for the site's domain and any domains that should redirect
// to it:
//
//   sudo logspace setup example.com www.example.com
//
// The domains are saved, so later runs can leave them out. Existing Caddy site blocks for these
// domains are replaced. The app's port is PORT in the env file (44100 when it isn't set), which
// Caddy is pointed at, so run it again after changing it.
import { Array as Arr, Console, Effect, FileSystem, Path } from 'effect'

import { promptAdminPassword } from './admin-password.ts'
import { addSite } from './caddyfile.ts'
import { ENV_FILE, readEnvFile, setEnvVariable } from './env-file.ts'
import { fail, IS_BINARY, reportFailures, requireRoot, run, VERSION } from './shell.ts'

export const DOMAINS_FILE = '/etc/logspace.domains'
export const SERVER_DATABASE_PATH = '/var/lib/logspace/app.sqlite'
const SERVICE_FILE = '/etc/systemd/system/logspace.service'
const CADDYFILE = '/etc/caddy/Caddyfile'
const DEFAULT_PORT = 44100

export const service = (binary: string) => `[Unit]
Description=LogSpace
After=network.target

[Service]
Type=exec
# The binary logspace setup was run from.
ExecStart=${binary} start
DynamicUser=yes
UMask=0077
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
RestrictRealtime=yes
LockPersonality=yes
CapabilityBoundingSet=
AmbientCapabilities=
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
# Bun uses JIT compilation: MemoryDenyWriteExecute is intentionally not enabled.
# The default port, which PORT in ${ENV_FILE} overrides (EnvironmentFile= wins over
# Environment=). logspace setup points Caddy at the same one.
Environment=PORT=${DEFAULT_PORT}
Environment=TRUST_PROXY=1
Environment=HOST=127.0.0.1
# The SQLite database, media, and caches live in folders systemd creates before the service starts
# (StateDirectory, CacheDirectory), which the app runs in.
StateDirectory=logspace
StateDirectoryMode=0700
CacheDirectory=logspace
CacheDirectoryMode=0700
WorkingDirectory=/var/lib/logspace
Environment=DATABASE_PATH=${SERVER_DATABASE_PATH}
# Media (post photos and videos, and the site's logo and icon), uploaded at /admin, is kept there
# too, as plain files.
Environment=MEDIA_STORAGE=fs
Environment=MEDIA_DIR=/var/lib/logspace/media
# Link previews.
Environment=CACHE_DIR=/var/cache/logspace
# Secrets (ADMIN_PASSWORD, AUTH_SESSION_SECRET) and PORT, readable only by root. logspace setup
# creates it.
EnvironmentFile=${ENV_FILE}
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
`

export const setup = Effect.fn('setup')(function* (args: readonly string[]) {
  if (process.platform !== 'linux') {
    return yield* fail('setup installs LogSpace on a Linux server, with systemd')
  }
  if (!IS_BINARY) {
    return yield* fail('setup makes a service of the built binary: run it from there')
  }
  yield* requireRoot
  let fs = yield* FileSystem.FileSystem

  let domains = Arr.isReadonlyArrayNonEmpty(args) ? args : yield* savedDomains
  if (!domains) {
    return yield* fail(
      "Give the site's domain, then any that should redirect to it, " +
        'e.g. logspace setup example.com www.example.com',
    )
  }
  for (let domain of domains) {
    if (!/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(domain)) {
      return yield* fail(`Not a domain: ${domain}`)
    }
  }
  // Checked before anything's changed.
  yield* run('caddy', 'version').pipe(
    Effect.mapError(() => fail("Caddy isn't installed: https://caddyserver.com/docs/install")),
  )

  yield* createEnvFile
  let env = yield* readEnvFile
  let port = env.get('PORT') || String(DEFAULT_PORT)
  if (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535 || Number(port) < 1024) {
    return yield* fail(`Expected an unprivileged port (1024–65535): PORT=${port} in ${ENV_FILE}`)
  }
  let binary = yield* fs.realPath(process.execPath)
  let problem = installedConfigProblem(binary, env)
  if (problem) return yield* fail(problem)
  for (let location of [
    '/var/lib/logspace',
    SERVER_DATABASE_PATH,
    '/var/lib/logspace/media',
    '/var/cache/logspace',
  ]) {
    if (!(yield* fs.exists(location))) continue
    let problem = installedPathProblem(location, yield* fs.realPath(location))
    if (problem) return yield* fail(problem)
  }
  yield* Console.log(`The app listens on 127.0.0.1:${port}`)
  if (!env.get('ADMIN_PASSWORD') && process.stdin.isTTY) {
    yield* Console.log('Choose a password for /admin, at least 16 characters long.')
    yield* setEnvVariable('ADMIN_PASSWORD', yield* promptAdminPassword)
  }

  yield* Console.log(`Installing logspace.service, which runs ${binary}...`)
  yield* fs.writeFileString(SERVICE_FILE, service(binary))
  yield* fs.chmod(SERVICE_FILE, 0o644)
  yield* run('systemctl', 'daemon-reload')
  yield* run('systemctl', 'enable', '--quiet', 'logspace')
  yield* run('systemctl', 'restart', 'logspace')

  yield* updateCaddyfile(domains, Number(port))
  yield* fs.writeFileString(DOMAINS_FILE, `${domains.join(' ')}\n`)

  yield* Console.log(`Done: LogSpace ${VERSION} is at https://${domains[0]}`)
  if (!(yield* readEnvFile).get('ADMIN_PASSWORD')) {
    yield* Console.log('Set the password for /admin with: sudo logspace set-admin-password')
  }
}, reportFailures)

// The domains the last setup was for.
const savedDomains = Effect.gen(function* () {
  let fs = yield* FileSystem.FileSystem
  if (!(yield* fs.exists(DOMAINS_FILE))) return undefined
  let domains = (yield* fs.readFileString(DOMAINS_FILE)).split(/\s+/).filter(Boolean)
  return Arr.isArrayNonEmpty(domains) ? domains : undefined
})

// Created once, with a random session secret and the default port.
const createEnvFile = Effect.gen(function* () {
  let fs = yield* FileSystem.FileSystem
  if (yield* fs.exists(ENV_FILE)) return yield* fs.chmod(ENV_FILE, 0o600)
  yield* Console.log(`Creating ${ENV_FILE}...`)
  let secret = crypto.getRandomValues(new Uint8Array(32)).toBase64()
  let env = `ADMIN_PASSWORD=\nAUTH_SESSION_SECRET=${secret}\nPORT=${DEFAULT_PORT}\n`
  yield* fs.writeFileString(ENV_FILE, env, { mode: 0o600, flag: 'wx' })
})

// Checks the new Caddyfile before it replaces the live one, and puts the old one back if Caddy
// rejects it on reload.
const updateCaddyfile = Effect.fnUntraced(function* (
  domains: Arr.NonEmptyReadonlyArray<string>,
  port: number,
) {
  let fs = yield* FileSystem.FileSystem
  let path = yield* Path.Path
  yield* Console.log(`Updating ${CADDYFILE}...`)
  let existing = (yield* fs.exists(CADDYFILE)) ? yield* fs.readFileString(CADDYFILE) : ''
  let result = addSite(existing, { domains, port })
  if (!result.ok) return yield* fail(result.error)

  yield* Effect.scoped(
    Effect.gen(function* () {
      let dir = yield* fs.makeTempDirectoryScoped({ prefix: 'logspace-caddy-' })
      let candidate = path.join(dir, 'Caddyfile')
      yield* fs.writeFileString(candidate, result.caddyfile)
      yield* run('caddy', 'validate', '--config', candidate, '--adapter', 'caddyfile')
    }),
  )

  let backup = `${CADDYFILE}.bak`
  yield* fs.makeDirectory(path.dirname(CADDYFILE), { recursive: true })
  yield* fs.writeFileString(backup, existing)
  yield* fs.writeFileString(CADDYFILE, result.caddyfile)
  yield* fs.chmod(CADDYFILE, 0o644)
  yield* run('systemctl', 'reload-or-restart', 'caddy').pipe(
    Effect.catch((error) =>
      fs
        .writeFileString(CADDYFILE, existing)
        .pipe(
          Effect.andThen(
            Effect.fail(
              fail(`Caddy didn't take the new config, so the old one is back. ${error.message}`),
            ),
          ),
        ),
    ),
  )
  yield* Console.log(`The previous Caddyfile is in ${backup}`)
})

// Refuse incompatible existing overrides before changing the unit or moving any data. systemd
// owns StateDirectory/CacheDirectory and migrates their existing contents to the dynamic user
// on restart. Custom storage needs an explicitly administered unit instead of a recursive chown
// of an arbitrary path. Keep secrets root-only: the system manager reads EnvironmentFile.
export function installedConfigProblem(
  binary: string,
  env: ReadonlyMap<string, string>,
): string | undefined {
  if (!/^\/(usr\/(local\/)?bin|var\/usrlocal\/bin|opt)\/[A-Za-z0-9_./-]+$/.test(binary)) {
    return 'Install the binary in /usr/local/bin (outside home directories) before running setup'
  }
  for (let [name, expected] of [
    ['HOST', '127.0.0.1'],
    ['TRUST_PROXY', '1'],
    ['MEDIA_STORAGE', 'fs'],
    ['DATABASE_PATH', SERVER_DATABASE_PATH],
    ['MEDIA_DIR', '/var/lib/logspace/media'],
    ['CACHE_DIR', '/var/cache/logspace'],
  ]) {
    if (name && expected && env.has(name) && env.get(name) !== expected) {
      return `${ENV_FILE}: ${name} must be ${expected} for the managed service; preserve your data and use a custom unit for custom paths`
    }
  }
}

// systemd's own private-directory symlinks are compatible with repeated setup. External storage
// symlinks are custom paths too; refuse them before replacing a working service's unit.
export function installedPathProblem(location: string, resolved: string): string | undefined {
  let privateLocation = location
    .replace('/var/lib/logspace', '/var/lib/private/logspace')
    .replace('/var/cache/logspace', '/var/cache/private/logspace')
  if (resolved !== location && resolved !== privateLocation) {
    return `${location} resolves to ${resolved}; preserve your data and use a custom unit for external storage`
  }
}
