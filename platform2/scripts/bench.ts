// Benchmarks this app against ../platform on the same sample posts: how fast each starts, how
// many requests a second each serves on its main routes (with autocannon), and how much memory
// each holds afterwards. Both run from source with Bun in production mode, on ports 44294 (old)
// and 44295 (new), one at a time, so they don't share the CPU.
//
//   bun scripts/bench.ts [seconds per run, default 10] [connections, default 32]
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import autocannon from 'autocannon'

const SECONDS = Number(process.argv[2] ?? 10)
const CONNECTIONS = Number(process.argv[3] ?? 32)
const ROOT = path.resolve(import.meta.dir, '..')
const OLD_ROOT = path.resolve(ROOT, '../platform')
const DATA = '/tmp/logspace-bench'
const SECRETS = {
  ADMIN_PASSWORD: 'bench-password-1234',
  AUTH_SESSION_SECRET: 'bench-session-secret',
}

interface App {
  name: string
  port: number
  cwd: string
  command: string[]
  env: Record<string, string>
  seed: string[]
}

const apps: App[] = [
  {
    name: 'platform (Remix 3)',
    port: 44294,
    cwd: OLD_ROOT,
    command: ['bun', 'server.ts'],
    env: {
      MEDIA_STORAGE: 'fs',
      MEDIA_DIR: `${DATA}/old/media`,
      DATABASE_PATH: `${DATA}/old/app.sqlite`,
      CACHE_DIR: `${DATA}/old/cache`,
    },
    seed: [
      'bun',
      '-e',
      "let s = await import('./test/seed.ts'); await s.seedMedia(); await s.seedDatabase(); process.exit(0)",
    ],
  },
  {
    name: 'platform2 (Effect + Datastar)',
    port: 44295,
    cwd: ROOT,
    command: ['bun', 'src/main.ts', 'start'],
    env: {
      MEDIA_DIR: `${DATA}/new/media`,
      DATABASE_PATH: `${DATA}/new/app.sqlite`,
      CACHE_DIR: `${DATA}/new/cache`,
    },
    seed: ['bun', 'scripts/seed.ts'],
  },
]

// The routes, as paths on the sample posts. A resized photo's URL is read from the home page.
const ROUTES: [string, (base: string) => Promise<string>][] = [
  ['home page', async () => '/'],
  ['article page', async () => '/posts/t83tytis1i'],
  ['photos page', async () => '/posts/drdp3ei6fd'],
  ['RSS feed', async () => '/rss.xml'],
  [
    'resized photo (WebP)',
    async (base) => {
      let html = await (await fetch(`${base}/`)).text()
      return html.match(/srcset="([^" ]+)/)![1].replaceAll('&amp;', '&')
    },
  ],
  ['video, 1 MB range', async () => '/posts/steq6e0rsh/flower.mp4'],
  ['admin login page', async () => '/admin/login'],
]

const env = (app: App) => ({
  ...process.env,
  ...SECRETS,
  ...app.env,
  NODE_ENV: 'production',
  PORT: String(app.port),
})

async function waitUntilUp(base: string, started: number) {
  for (;;) {
    let response = await fetch(`${base}/`).catch(() => undefined)
    if (response?.status === 200) return performance.now() - started
    await Bun.sleep(5)
  }
}

let results: Record<string, Record<string, unknown>> = {}
await fs.rm(DATA, { recursive: true, force: true })

for (let app of apps) {
  let seeded = Bun.spawnSync(app.seed, {
    cwd: app.cwd,
    env: env(app),
    stdout: 'ignore',
    stderr: 'inherit',
  })
  if (!seeded.success) throw new Error(`Couldn't seed ${app.name}`)
  let base = `http://localhost:${app.port}`
  let result: Record<string, unknown> = {}
  results[app.name] = result

  // Startup: from spawning the process to the first page, the median of five.
  let startups: number[] = []
  for (let i = 0; i < 5; i++) {
    let started = performance.now()
    let server = Bun.spawn(app.command, {
      cwd: app.cwd,
      env: env(app),
      stdout: 'ignore',
      stderr: 'ignore',
    })
    startups.push(await waitUntilUp(base, started))
    server.kill()
    await server.exited
  }
  result['startup to first page (ms)'] = Math.round(startups.toSorted((a, b) => a - b)[2])

  let server = Bun.spawn(app.command, {
    cwd: app.cwd,
    env: env(app),
    stdout: 'ignore',
    stderr: 'inherit',
  })
  await waitUntilUp(base, performance.now())
  let idle = rss(server.pid)
  for (let [name, route] of ROUTES) {
    let url = base + (await route(base))
    let headers: Record<string, string> = name.includes('range') ? { Range: 'bytes=0-1048575' } : {}
    // Warm up: caches filled, resized copies made, JIT warmed.
    await run(url, headers, Math.min(3, SECONDS))
    let r = await run(url, headers, SECONDS)
    result[name] = {
      'requests/s': Math.round(r.requests.average),
      'p50 ms': r.latency.p50,
      'p99 ms': r.latency.p99,
      errors: r.errors + r.non2xx,
      'bytes/request': Math.round(r.throughput.total / Math.max(1, r.requests.total)),
    }
  }
  result['memory idle (MB)'] = await idle
  result['memory after load (MB)'] = await rss(server.pid)
  server.kill()
  await server.exited
}

function run(url: string, headers: Record<string, string>, duration: number) {
  return autocannon({ url, headers, connections: CONNECTIONS, duration, pipelining: 1 })
}

async function rss(pid: number) {
  let out = Bun.spawnSync(['ps', '-o', 'rss=', '-p', String(pid)])
    .stdout.toString()
    .trim()
  return Math.round(Number(out) / 1024)
}

await fs.mkdir(path.join(ROOT, 'dist'), { recursive: true })
await Bun.write(path.join(ROOT, 'dist/bench.json'), JSON.stringify(results, null, 2))

// A Markdown table, old beside new.
let [old, now] = apps.map((app) => results[app.name])
let rows = [['', ...apps.map((app) => app.name), 'new ÷ old']]
for (let key of ['startup to first page (ms)', 'memory idle (MB)', 'memory after load (MB)']) {
  rows.push([
    key,
    String(old[key]),
    String(now[key]),
    ratio(now[key] as number, old[key] as number),
  ])
}
for (let [name] of ROUTES) {
  let [a, b] = [old[name], now[name]] as Record<string, number>[]
  rows.push([
    `${name}: requests/s (p50 / p99 ms)`,
    `${a['requests/s']} (${a['p50 ms']} / ${a['p99 ms']})`,
    `${b['requests/s']} (${b['p50 ms']} / ${b['p99 ms']})`,
    ratio(b['requests/s'], a['requests/s']),
  ])
  if (a.errors || b.errors) rows.push([`${name}: errors`, String(a.errors), String(b.errors), ''])
}
console.log(
  rows
    .map((row, i) => `| ${row.join(' | ')} |${i === 0 ? `\n|${' --- |'.repeat(row.length)}` : ''}`)
    .join('\n'),
)

function ratio(a: number, b: number) {
  return `${(a / b).toFixed(2)}×`
}
