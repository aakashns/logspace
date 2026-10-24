// Checks package.json's version, which merging to main releases (see
// .github/workflows/release.yml), and prints what CI should do, for $GITHUB_OUTPUT:
//
//   version=0.4.1   package.json's version
//   release=true    whether to release it (the version changed)
//   build=true      whether to build and test the binary
//
// Given the git ref the changes are on top of (a PR's base, or main before a push), it checks the
// version moves one step if what goes into the binary changed, and stays put if not, so only
// changes to the binary make releases. Below 1.0, bump the minor version for breaking changes and
// the patch version for others. Without a ref, it releases and builds.
//
//   bun scripts/check-version.ts [<base ref>]
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const PACKAGE = 'package.json'
// What the binary is made of, from the repository's root, apart from the tests beside the code
// (TESTS). package.json is in it too, apart from its version.
const BINARY = [
  'platform/src/',
  'platform/db/',
  'platform/public/',
  'platform/bun.lock',
  'platform/tsconfig.json',
  'platform/scripts/build.ts',
]
const TESTS = /\.(test|pw)\.ts$/
// What tests the binary, which needs a build to check but not a release.
const BINARY_TESTS = [
  'platform/scripts/smoke-test.ts',
  'platform/scripts/deploy-test.ts',
  '.github/workflows/release.yml',
]

let root = fileURLToPath(new URL('../', import.meta.url))
let file = fs.readFileSync(`${root}${PACKAGE}`, 'utf8')
let version = parseVersion(file)
if (!version) fail(`${PACKAGE}'s version should be a release's, like 0.1.0`)

let release = true
let build = true
let base = process.argv[2]
if (base) {
  let baseFile = git('show', `${base}:./${PACKAGE}`)
  // Before there were releases, there was no version.
  let [major, minor, patch] = parseVersion(baseFile) ?? [0, 0, 0]
  let changed = git('diff', '--name-only', base, 'HEAD').split('\n')
  let binaryChanged =
    changed.some((path) => !TESTS.test(path) && BINARY.some((input) => path.startsWith(input))) ||
    withoutVersion(file) !== withoutVersion(baseFile)
  release = version.join('.') !== [major, minor, patch].join('.')
  build = binaryChanged || changed.some((path) => BINARY_TESTS.includes(path))

  if (binaryChanged) {
    let bumps = [
      [major, minor, patch + 1],
      [major, minor + 1, 0],
      [major + 1, 0, 0],
    ].map((bump) => bump.join('.'))
    if (!bumps.includes(version.join('.'))) {
      fail(
        `The binary changed, so ${PACKAGE}'s version should be one of ${bumps.join(', ')}, one ` +
          `step from ${base}'s ${[major, minor, patch].join('.')}, but it's ` +
          `${version.join('.')}. Below 1.0, bump the minor version for breaking changes and the ` +
          'patch version for others.',
      )
    }
  } else if (release) {
    fail(
      `Nothing in the binary changed, so ${PACKAGE}'s version should stay ` +
        `${[major, minor, patch].join('.')}, not ${version.join('.')}: a release would be the same ` +
        'binary.',
    )
  }
}
console.log(`version=${version.join('.')}\nrelease=${release}\nbuild=${build}`)

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
}

function parseVersion(packageJson: string): [number, number, number] | undefined {
  let parsed: unknown = JSON.parse(packageJson)
  let version =
    typeof parsed === 'object' && parsed !== null && 'version' in parsed
      ? parsed.version
      : undefined
  let [, major, minor, patch] = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version)) ?? []
  if (major === undefined || minor === undefined || patch === undefined) return undefined
  return [Number(major), Number(minor), Number(patch)]
}

// package.json as the binary sees it: its version only names the release.
function withoutVersion(packageJson: string): string {
  let parsed: unknown = JSON.parse(packageJson)
  if (typeof parsed !== 'object' || parsed === null) return JSON.stringify(parsed)
  return JSON.stringify({ ...parsed, version: undefined })
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
