// `logspace set-admin-password`: sets the admin password (for /admin) in the service's env file
// and restarts the service, which logs out every browser. The password is read without echoing,
// so it stays out of shell history, or a line at a time from stdin when it isn't a terminal.
import { Console, Effect, FileSystem, Redacted, Terminal } from 'effect'
import { Prompt } from 'effect/cli'

import { ENV_FILE, setEnvVariable } from './env-file.ts'
import { fail, reportFailures, requireRoot, run } from './shell.ts'

// What the app needs to switch /admin on (see ../admin/session.ts).
const MIN_LENGTH = 16

export const setAdminPassword = Effect.gen(function* () {
  yield* requireRoot
  if (!(yield* (yield* FileSystem.FileSystem).exists(ENV_FILE))) {
    return yield* fail(`${ENV_FILE} isn't there. Run logspace deploy first.`)
  }
  yield* setEnvVariable('ADMIN_PASSWORD', yield* promptAdminPassword)
  yield* run('systemctl', 'restart', 'logspace')
  yield* Console.log('Password updated and logspace restarted.')
}).pipe(reportFailures)

export const promptAdminPassword = Effect.gen(function* () {
  let password = yield* readSecret('New admin password')
  let again = yield* readSecret('Again')
  if (password !== again) return yield* fail("The passwords don't match")
  if (password.length < MIN_LENGTH) return yield* fail(`Use at least ${MIN_LENGTH} characters`)
  // systemd strips quotes and backslashes and trims spaces when it reads the env file, so a
  // password with them would no longer match what was typed.
  if (/["'\\]/.test(password) || /^\s|\s$/.test(password)) {
    return yield* fail('Use a password without quotes, backslashes, or leading or trailing spaces')
  }
  return password
})

// Reads a line from the terminal without showing it, or from stdin when it isn't a terminal.
const readSecret = (question: string) =>
  Effect.gen(function* () {
    if (process.stdin.isTTY) {
      return Redacted.value(yield* Prompt.run(Prompt.Hidden({ message: question })))
    }
    let terminal = yield* Terminal.Terminal
    yield* terminal.display(`${question}: `)
    let line = yield* terminal.readLine
    yield* terminal.display('\n')
    return line
  }).pipe(Effect.catchTag('QuitError', () => Effect.fail(fail('No password given'))))
