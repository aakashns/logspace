// The logspace binary's command line. Its default command, start, runs the server; the others set
// up and maintain a server it runs on. Each command's module is imported when it's run, so the
// others don't load the server or the image codecs.
import { BunRuntime, BunServices } from '@effect/platform-bun'
import { Console, Effect, Option } from 'effect'
import { Argument, Command, Flag } from 'effect/cli'

import { VERSION } from './cli/shell.ts'

const runServer = Effect.flatMap(
  Effect.promise(() => import('./cli/start.ts')),
  (module) => module.start,
)

const start = Command.make('start', {}, () => runServer).pipe(
  Command.withDescription('Start the server (the default)'),
)

const setup = Command.make(
  'setup',
  {
    domains: Argument.String('domain').pipe(
      Argument.variadic(),
      Argument.withDescription("The site's domain, then any that redirect to it"),
    ),
  },
  ({ domains }) =>
    Effect.flatMap(
      Effect.promise(() => import('./cli/setup.ts')),
      (module) => module.setup(domains),
    ),
).pipe(
  Command.withDescription(
    'Install LogSpace on this server as a service behind Caddy, for the site’s domain and any domains that redirect to it (as root)',
  ),
)

const setAdminPassword = Command.make('set-admin-password', {}, () =>
  Effect.flatMap(
    Effect.promise(() => import('./cli/admin-password.ts')),
    (module) => module.setAdminPassword,
  ),
).pipe(Command.withDescription('Set the password for /admin (as root)'))

const migrate = Command.make(
  'migrate',
  {
    dryRun: Flag.Boolean('dry-run').pipe(
      Flag.withDescription('Only list them'),
      Flag.withDefault(false),
    ),
  },
  ({ dryRun }) =>
    Effect.flatMap(
      Effect.promise(() => import('./cli/migrate.ts')),
      (module) => module.migrate(dryRun),
    ),
).pipe(
  Command.withDescription(
    'Apply the database migrations that haven’t run yet (the server does when it starts), or list them',
  ),
)

const upgrade = Command.make(
  'upgrade',
  {
    version: Argument.String('version').pipe(Argument.optional),
    yes: Flag.Boolean('yes').pipe(
      Flag.withAlias('y'),
      Flag.withDescription('Don’t ask first'),
      Flag.withDefault(false),
    ),
  },
  ({ version, yes }) =>
    Effect.flatMap(
      Effect.promise(() => import('./cli/upgrade.ts')),
      (module) => module.upgrade(Option.getOrUndefined(version), yes),
    ),
).pipe(Command.withDescription('Replace this binary with the latest release, or the given one'))

const logspace = Command.make('logspace', {}, () => runServer).pipe(
  Command.withDescription(
    `LogSpace ${VERSION}. The server is configured with environment variables: PORT (44100), HOST (::), ` +
      'DATABASE_PATH (data/app.sqlite), MEDIA_DIR (data/media), CACHE_DIR (data/cache), ' +
      'ADMIN_PASSWORD and AUTH_SESSION_SECRET (the admin password and the secret that signs its ' +
      'session cookie), and TRUST_PROXY=1 behind a reverse proxy.',
  ),
  Command.withSubcommands([start, setup, setAdminPassword, migrate, upgrade]),
)

// The old binary's spellings of help and version, which prints the version alone, for scripts.
const argv = process.argv.slice(2)
if (argv[0] === 'help') argv[0] = '--help'
const program = ['version', '--version', '-v'].includes(argv[0] ?? '')
  ? Console.log(VERSION)
  : Command.runWith(logspace, { version: VERSION })(argv)

program.pipe(
  // Printed with its message alone. It still fails the run, so the binary exits with 1.
  Effect.tapErrorTag('CommandError', (error) => Console.error(`Error: ${error.message}`)),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
)
