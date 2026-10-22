// What the binary's commands share (see main.ts).
import { spawnSync } from 'node:child_process'

import packageJson from '../package.json' with { type: 'json' }

declare const Bun: { isStandaloneExecutable: boolean }

// The release this is (platform/package.json's version, which every change to main bumps).
export const VERSION = packageJson.version

// Whether this is the built binary, rather than `bun binary/main.ts` in a checkout, whose
// process.execPath is Bun's.
export const IS_BINARY = Bun.isStandaloneExecutable

// An error to report with its message alone (without a stack), like a usage mistake or a failed
// download.
export class CommandError extends Error {}

export function requireRoot(): void {
  if (process.getuid?.() !== 0) throw new CommandError('Run it as root, e.g. with sudo')
}

// Runs a program to completion, showing its output only if it fails.
export function run(program: string, ...args: string[]): void {
  let result = spawnSync(program, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
  if (result.error) throw new CommandError(`Couldn't run ${program}: ${result.error.message}`)
  if (result.status !== 0) {
    let output = `${result.stdout}${result.stderr}`.trim()
    throw new CommandError(`${[program, ...args].join(' ')} failed${output ? `:\n${output}` : ''}`)
  }
}
