// Compares the size of this app's code with ../platform's, area by area: non-blank lines, and of
// those, how many are code rather than comments (both apps explain themselves at length). Vendored
// Datastar, test fixtures, and lockfiles aren't counted.
//
//   bun scripts/compare-size.ts
import * as fs from 'node:fs'
import * as path from 'node:path'

const REPO = path.resolve(import.meta.dir, '../..')

type Area = 'server' | 'pages' | 'styles' | 'browser' | 'cli & build' | 'tests'

// The first pattern a file matches says what it is.
const APPS: Record<string, { dir: string; areas: [RegExp, Area][] }> = {
  platform: {
    dir: 'platform',
    areas: [
      [/\.test\.tsx?$|^test\/|^binary\/(smoke-test|setup-test|fake-s3)\.ts$/, 'tests'],
      [/\/public\/.*\.css$/, 'styles'],
      [/\/public\/.*\.tsx?$/, 'browser'],
      [/^app\/(actions|ui)\/.*\.tsx$/, 'pages'],
      [/^binary\/|^scripts\/|^app\/(asset-server|prebuilt-assets)\.ts$/, 'cli & build'],
      [/^app\/|^server\.ts$|^db\/migrations\/.*\/up\.sql$/, 'server'],
    ],
  },
  platform2: {
    dir: 'platform2',
    areas: [
      [/^test\//, 'tests'],
      [/\.css$/, 'styles'],
      [/^src\/views\/|^src\/jsx\//, 'pages'],
      [/^src\/cli\/|^src\/main\.ts$|^scripts\/(build|binary-sharp)\.ts$/, 'cli & build'],
      [/^src\/|^db\/migrations\/.*\.sql$/, 'server'],
    ],
  },
}

const SKIPPED = /node_modules|\/content\/|^dist\/|datastar\.js$/

function count(app: (typeof APPS)[string]) {
  let totals = new Map<Area, { lines: number; code: number; files: number }>()
  let root = path.join(REPO, app.dir)
  for (let file of fs.readdirSync(root, { recursive: true }) as string[]) {
    if (!/\.(tsx?|css|sql)$/.test(file) || SKIPPED.test(file)) continue
    let area = app.areas.find(([pattern]) => pattern.test(file))?.[1]
    if (!area) continue
    let lines = fs
      .readFileSync(path.join(root, file), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
    let code = lines.filter((line) => !/^\s*(\/\/|\/\*|\*|--)/.test(line)).length
    let total = totals.get(area) ?? { lines: 0, code: 0, files: 0 }
    totals.set(area, {
      lines: total.lines + lines.length,
      code: total.code + code,
      files: total.files + 1,
    })
  }
  return totals
}

let results = Object.fromEntries(Object.entries(APPS).map(([name, app]) => [name, count(app)]))
let areas: Area[] = ['server', 'pages', 'styles', 'browser', 'cli & build', 'tests']
let cell = (name: string, area: Area | 'total') => {
  let values =
    area === 'total'
      ? [...results[name].entries()].filter(([a]) => a !== 'tests').map(([, v]) => v)
      : [results[name].get(area) ?? { lines: 0, code: 0, files: 0 }]
  let lines = values.reduce((sum, v) => sum + v.lines, 0)
  let code = values.reduce((sum, v) => sum + v.code, 0)
  let files = values.reduce((sum, v) => sum + v.files, 0)
  return { lines, code, files }
}

console.log('| Area | platform (files / lines / code) | platform2 (files / lines / code) |')
console.log('| --- | --- | --- |')
for (let area of [...areas, 'total' as const]) {
  let [a, b] = ['platform', 'platform2'].map((name) => cell(name, area))
  let label = area === 'total' ? '**total, without tests**' : area
  console.log(
    `| ${label} | ${a.files} / ${a.lines} / ${a.code} | ${b.files} / ${b.lines} / ${b.code} |`,
  )
}
