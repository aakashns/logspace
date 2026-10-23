// What the binary's commands share (see ../main.ts).
import { Effect, Schema } from 'effect'

import packageJson from '../../package.json' with { type: 'json' }

// The release this is (package.json's version).
export const VERSION = packageJson.version

// Whether this is the built binary, rather than `bun src/main.ts` in a checkout.
export const IS_BINARY = Bun.isStandaloneExecutable

// A failure to report with its message alone (without a stack), like a usage mistake or a
// failed download.
export class CommandError extends Schema.TaggedError<CommandError>()('CommandError', {
  message: Schema.String,
}) {}

export const fail = (message: string) => new CommandError({ message })

export const requireRoot = Effect.suspend(() =>
  process.getuid?.() === 0 ? Effect.void : Effect.fail(fail('Run it as root, e.g. with sudo')),
)

// Runs a program to completion, showing its output only if it fails.
export const run = (program: string, ...args: string[]) =>
  Effect.suspend(() => {
    let result
    try {
      result = Bun.spawnSync([program, ...args], {
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      })
    } catch (error) {
      return Effect.fail(fail(`Couldn't run ${program}: ${(error as Error).message}`))
    }
    if (result.success) return Effect.void
    let output = `${result.stdout.toString()}${result.stderr.toString()}`.trim()
    return Effect.fail(
      fail(`${[program, ...args].join(' ')} failed${output ? `:\n${output}` : ''}`),
    )
  })
