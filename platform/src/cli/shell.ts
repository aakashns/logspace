// What the binary's commands share (see ../main.ts).
import { Config, Effect, PlatformError, Runtime, Schema, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

import packageJson from '../../package.json' with { type: 'json' }

// The release this is (package.json's version).
export const VERSION = packageJson.version

// Whether this is the built binary, rather than `bun src/main.ts` in a checkout.
export const IS_BINARY = Bun.isStandaloneExecutable

// A failure to report with its message alone (without a stack), like a usage mistake or a
// failed download. main.ts prints it, so the runtime doesn't log it again.
export class CommandError extends Schema.TaggedError<CommandError>()('CommandError', {
  message: Schema.String,
}) {
  override readonly [Runtime.errorReported] = false
}

export const fail = (message: string) => new CommandError({ message })

// A command's file and process failures (a permissions mistake, a missing program) and mistakes
// in the environment (PORT=abc), reported like its other failures: with their message alone.
export const reportFailures = <A, R>(
  effect: Effect.Effect<A, CommandError | PlatformError.PlatformError | Config.ConfigError, R>,
): Effect.Effect<A, CommandError, R> =>
  Effect.catchTags(effect, {
    PlatformError: (error) => Effect.fail(fail(error.message)),
    ConfigError: (error) => Effect.fail(fail(error.message)),
  })

export const requireRoot = Effect.suspend(() =>
  process.getuid?.() === 0 ? Effect.void : Effect.fail(fail('Run it as root, e.g. with sudo')),
)

// Runs a program to completion, showing its output only if it fails.
export const run = Effect.fnUntraced(
  function* (program: string, ...args: string[]) {
    let spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    let handle = yield* spawner
      .spawn(ChildProcess.make(program, args, { stdin: 'ignore' }))
      .pipe(Effect.mapError((error) => fail(`Couldn't run ${program}: ${error.message}`)))
    let [output, exitCode] = yield* Effect.all(
      [Stream.mkString(Stream.decodeText(handle.all)), handle.exitCode],
      { concurrency: 'unbounded' },
    )
    if (exitCode === 0) return
    let shown = output.trim()
    return yield* fail(`${[program, ...args].join(' ')} failed${shown ? `:\n${shown}` : ''}`)
  },
  Effect.scoped,
  reportFailures,
)
