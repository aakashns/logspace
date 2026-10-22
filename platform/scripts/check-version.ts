// Checks package.json's version, which merging to main releases (see
// .github/workflows/release.yml), and prints it. Given the git ref a PR merges into, it checks the
// PR bumps it one step from there: below 1.0, the minor version for breaking changes and the patch
// version for others.
//
//   bun scripts/check-version.ts [<base ref>]
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const PACKAGE = 'package.json'

let root = fileURLToPath(new URL('../', import.meta.url))
let version = parseVersion(fs.readFileSync(`${root}${PACKAGE}`, 'utf8'))
if (!version) fail(`${PACKAGE}'s version should be a release's, like 0.1.0`)

let base = process.argv[2]
if (base) {
  let file = execFileSync('git', ['show', `${base}:./${PACKAGE}`], { cwd: root, encoding: 'utf8' })
  // Before there were releases, there was no version.
  let [major, minor, patch] = parseVersion(file) ?? [0, 0, 0]
  let bumps = [
    [major, minor, patch + 1],
    [major, minor + 1, 0],
    [major + 1, 0, 0],
  ].map((bump) => bump.join('.'))
  if (!bumps.includes(version.join('.'))) {
    fail(
      `${PACKAGE}'s version is ${version.join('.')}, but should be one of ${bumps.join(', ')}, ` +
        `one step from ${base}'s ${[major, minor, patch].join('.')}. Below 1.0, bump the minor ` +
        'version for breaking changes and the patch version for others.',
    )
  }
}
console.log(version.join('.'))

function parseVersion(packageJson: string): number[] | undefined {
  let { version } = JSON.parse(packageJson) as { version?: unknown }
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) return undefined
  return version.split('.').map(Number)
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
