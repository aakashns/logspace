// Counts the repo's non-blank lines of source, test, and config code (docs, fixtures, and lockfiles
// aren't code). Includes files git doesn't track yet, unless they're ignored.
//
//   bun scripts/count-lines.ts [-v]    -v lists each file's count too
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'

type Kind = 'source' | 'test' | 'config'

// The first pattern a file matches says what it is.
const KINDS: [RegExp, Kind][] = [
  [
    /\.(test|pw)\.tsx?$|^platform\/test\/|^platform\/scripts\/(smoke-test|deploy-test)\.ts$/,
    'test',
  ],
  [/^platform\/(src\/|db\/migrations\/.*\.sql$)|^platform\/scripts\/|^install\.sh$/, 'source'],
  [/\.(json|toml)$|^\.github\/|\.gitignore$/, 'config'],
]
const SKIPPED = /\.lock$|\/test\/content\/|\.woff2$|datastar\.js$/

let verbose = process.argv[2] === '-v'
let root = fileURLToPath(new URL('../..', import.meta.url))
let files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  cwd: root,
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean)
  .sort()

let totals: Record<Kind, number> = { source: 0, test: 0, config: 0 }
for (let file of files) {
  let kind = KINDS.find(([pattern]) => pattern.test(file))?.[1]
  if (
    !kind ||
    SKIPPED.test(file) ||
    !fs.statSync(`${root}${file}`, { throwIfNoEntry: false })?.isFile()
  ) {
    continue
  }
  let lines = fs
    .readFileSync(`${root}${file}`, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0).length
  totals[kind] += lines
  if (verbose) console.log(`${String(lines).padStart(6)}  ${kind.padEnd(6)}  ${file}`)
}

let total = totals.source + totals.test + totals.config
for (let [name, count] of [...Object.entries(totals), ['total', total] as const]) {
  console.log(`${name.padEnd(7)} ${String(count).padStart(6)}`)
}
