// The service's env file, which `logspace setup` creates: the secrets (ADMIN_PASSWORD,
// AUTH_SESSION_SECRET) and PORT, readable only by root and loaded by systemd.
import * as fs from 'node:fs'

export const ENV_FILE = '/etc/logspace.env'

// Its variables as systemd reads them: the last line for a name wins, and quotes around a value
// are dropped.
export function readEnvFile(): Map<string, string> {
  let variables = new Map<string, string>()
  for (let line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    let match = /^\s*([A-Za-z_]\w*)=(.*)$/.exec(line)
    if (match) variables.set(match[1], match[2].trim().replace(/^(["'])(.*)\1$/, '$2'))
  }
  return variables
}

// Sets a variable, keeping the file's other lines, and keeping it root-only throughout: the new
// file is written beside it and moved into place.
export function setEnvVariable(name: string, value: string): void {
  let lines = fs
    .readFileSync(ENV_FILE, 'utf8')
    .split('\n')
    .filter((line) => !line.startsWith(`${name}=`))
  if (lines.at(-1) === '') lines.pop()
  let tmp = `${ENV_FILE}.${process.pid}.tmp`
  // Created afresh (wx), so it has the mode from the start.
  fs.rmSync(tmp, { force: true })
  fs.writeFileSync(tmp, `${[...lines, `${name}=${value}`].join('\n')}\n`, {
    mode: 0o600,
    flag: 'wx',
  })
  fs.renameSync(tmp, ENV_FILE)
}
