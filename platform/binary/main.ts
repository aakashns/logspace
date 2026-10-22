// The logspace binary's entry point (see build.ts), a command line whose default command, start,
// runs the same server as `bun server.ts`. Each command is imported when it's run, so the others
// don't start the server or load sharp.
import { CommandError, VERSION } from './command.ts'

const HELP = `LogSpace ${VERSION}

Usage: logspace [command]

Commands:
  start                       start the server (the default)
  setup [domain...]           install LogSpace on this server as a service behind Caddy, for the
                              site's domain and any domains that redirect to it (as root)
  set-admin-password          set the password for /admin (as root)
  upgrade [version] [--yes]   replace this binary with the latest release, or the given one
  version                     print the version
  help                        print this help

The server is configured with environment variables (see the README), including:
  PORT              the port to listen on (44100)
  DATABASE_PATH     the SQLite database (data/app.sqlite)
  MEDIA_DIR         the folder for uploaded media (data/media)
  CACHE_DIR         the folder for caches (data/cache)
  ADMIN_PASSWORD, AUTH_SESSION_SECRET
                    the admin password and the secret that signs its session cookie`

const COMMANDS = new Map<string, (args: string[]) => Promise<void>>(
  Object.entries({
    start: async (args: string[]) => {
      noArguments(args)
      await (await import('./start.ts')).start()
    },
    setup: async (args: string[]) => (await import('./setup.ts')).setup(args),
    'set-admin-password': async (args: string[]) => {
      noArguments(args)
      await (await import('./admin-password.ts')).setAdminPassword()
    },
    upgrade: async (args: string[]) => (await import('./upgrade.ts')).upgrade(args),
    version: async (args: string[]) => {
      noArguments(args)
      console.log(VERSION)
    },
    help: async () => console.log(HELP),
  }),
)
const ALIASES = new Map([
  ['--version', 'version'],
  ['-v', 'version'],
  ['--help', 'help'],
  ['-h', 'help'],
])

let [name = 'start', ...args] = process.argv.slice(2)
let command = COMMANDS.get(ALIASES.get(name) ?? name)
if (!command) {
  console.error(`Unknown command: ${name}\n\n${HELP}`)
  process.exit(1)
}
try {
  await command(args)
} catch (error) {
  if (!(error instanceof CommandError)) throw error
  console.error(`Error: ${error.message}`)
  process.exit(1)
}

function noArguments(args: string[]) {
  if (args.length > 0) throw new CommandError(`Unexpected arguments: ${args.join(' ')}`)
}
