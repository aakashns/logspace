// The service's env file, which `logspace deploy` creates: the secrets (ADMIN_PASSWORD,
// AUTH_SESSION_SECRET) and PORT, readable only by root and loaded by systemd.
import { Effect, FileSystem } from 'effect'

export const ENV_FILE = '/etc/logspace.env'

// Its variables as systemd reads them: the last line for a name wins, and quotes around a value
// are dropped.
export const readEnvFile = Effect.gen(function* () {
  let fs = yield* FileSystem.FileSystem
  let variables = new Map<string, string>()
  for (let line of (yield* fs.readFileString(ENV_FILE)).split('\n')) {
    let [, name, value] = /^\s*([A-Za-z_]\w*)=(.*)$/.exec(line) ?? []
    if (name !== undefined && value !== undefined) {
      variables.set(name, value.trim().replace(/^(["'])(.*)\1$/, '$2'))
    }
  }
  return variables
})

// Sets a variable, keeping the file's other lines, and keeping it root-only throughout: the new
// file is written beside it and moved into place.
export const setEnvVariable = Effect.fnUntraced(function* (name: string, value: string) {
  let fs = yield* FileSystem.FileSystem
  let lines = (yield* fs.readFileString(ENV_FILE))
    .split('\n')
    .filter((line) => !line.startsWith(`${name}=`))
  if (lines.at(-1) === '') lines.pop()
  let tmp = `${ENV_FILE}.${process.pid}.tmp`
  // Created afresh (wx), so it has the mode from the start.
  yield* fs.remove(tmp, { force: true })
  yield* fs.writeFileString(tmp, `${[...lines, `${name}=${value}`].join('\n')}\n`, {
    mode: 0o600,
    flag: 'wx',
  })
  yield* fs.rename(tmp, ENV_FILE)
})
