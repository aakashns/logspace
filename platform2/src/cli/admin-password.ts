// `logspace set-admin-password`: sets the admin password (for /admin) in the service's env file
// and restarts the service, which logs out every browser. The password is read without echoing,
// so it stays out of shell history, or a line at a time from stdin when it isn't a terminal.
import * as fs from 'node:fs'
import { Console, Effect } from 'effect'

import { ENV_FILE, setEnvVariable } from './env-file.ts'
import { fail, requireRoot, run } from './shell.ts'

// What the app needs to switch /admin on (see http/session.ts).
const MIN_LENGTH = 16

export const setAdminPassword = Effect.gen(function* () {
  yield* requireRoot
  if (!fs.existsSync(ENV_FILE))
    return yield* fail(`${ENV_FILE} isn't there. Run logspace setup first.`)
  setEnvVariable('ADMIN_PASSWORD', yield* promptAdminPassword)
  yield* run('systemctl', 'restart', 'logspace')
  yield* Console.log('Password updated and logspace restarted.')
})

export const promptAdminPassword = Effect.gen(function* () {
  let password = yield* readSecret('New admin password: ')
  let again = yield* readSecret('Again: ')
  if (password !== again) return yield* fail("The passwords don't match")
  if (password.length < MIN_LENGTH) return yield* fail(`Use at least ${MIN_LENGTH} characters`)
  // systemd strips quotes and backslashes and trims spaces when it reads the env file, so a
  // password with them would no longer match what was typed.
  if (/["'\\]/.test(password) || /^\s|\s$/.test(password)) {
    return yield* fail('Use a password without quotes, backslashes, or leading or trailing spaces')
  }
  return password
})

// What was typed past the line a read took, which the next one starts with.
let typedAhead: string[] = []

// Reads a line from the terminal without showing it, or from stdin when it isn't a terminal.
const readSecret = (question: string) =>
  Effect.tryPromise({
    try: () => readSecretPromise(question),
    catch: (error) => fail(error instanceof Error ? error.message : String(error)),
  })

async function readSecretPromise(question: string): Promise<string> {
  let stdin = process.stdin
  if (!stdin.isTTY) {
    let line = prompt(question.trimEnd())
    console.log()
    if (line === null) throw new Error('No password given')
    return line
  }
  process.stdout.write(question)
  stdin.setRawMode(true)
  stdin.setEncoding('utf8')
  let line = ''
  try {
    return await new Promise<string>((resolve, reject) => {
      let onData = (chunk: string) => {
        let chars = Array.from(chunk)
        for (let [i, char] of chars.entries()) {
          if (char === '\r' || char === '\n') {
            typedAhead = chars.slice(char === '\r' && chars[i + 1] === '\n' ? i + 2 : i + 1)
            return resolve(line)
          }
          // Ctrl-C and Ctrl-D, which raw mode passes on as characters.
          if (char === '\u0003' || char === '\u0004') return reject(new Error('Cancelled'))
          if (char === '\u007f' || char === '\b') line = Array.from(line).slice(0, -1).join('')
          else line += char
        }
      }
      onData(typedAhead.splice(0).join(''))
      stdin.on('data', onData)
      stdin.resume()
    })
  } finally {
    stdin.removeAllListeners('data')
    stdin.setRawMode(false)
    stdin.pause()
    process.stdout.write('\n')
  }
}
