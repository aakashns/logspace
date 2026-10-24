import { test as base, expect, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(new URL('./server.ts', import.meta.url))
export const composePath = '/admin/posts/new'

class Application {
  origin = ''
  password = crypto.randomUUID()
  private secret = crypto.randomUUID()
  private child?: ChildProcess
  logs = ''
  constructor(readonly directory: string) {}

  async start() {
    const child = spawn(
      'bun',
      [
        '--no-env-file',
        '--tsconfig-override',
        fileURLToPath(new URL('../tsconfig.json', import.meta.url)),
        entry,
        this.directory,
        this.password,
        this.secret,
      ],
      {
        cwd: this.directory,
        // No developer credentials, proxy settings, database paths, or dotenv files.
        env: { PATH: process.env.PATH, NODE_ENV: 'test' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    this.child = child
    child.stderr?.on('data', (chunk) => {
      this.logs += String(chunk)
    })
    if (!child.stdout) throw new Error('Missing server stdout')
    child.stdout.on('data', (chunk) => {
      this.logs += String(chunk)
    })
    const lines = createInterface({ input: child.stdout })
    try {
      this.origin = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`Server startup timed out\n${this.logs}`)),
          15_000,
        )
        const finish = () => clearTimeout(timeout)
        child.once('error', (error) => {
          finish()
          reject(error)
        })
        child.once('exit', (code) => {
          finish()
          reject(new Error(`Server exited ${code}\n${this.logs}`))
        })
        lines.on('line', (line) => {
          if (line.startsWith('READY ')) {
            finish()
            resolve(line.slice(6))
          }
        })
      })
      await expect.poll(async () => (await fetch(`${this.origin}/admin/login`)).status).toBe(200)
    } finally {
      lines.close()
      // readline.close() pauses its input even when the log listener still needs it.
      child.stdout.resume()
    }
  }

  async stop() {
    const child = this.child
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => child.kill('SIGKILL'), 5_000)
      child.once('exit', (code, exitSignal) => {
        clearTimeout(timeout)
        // Effect exits with 130 after a clean interruption, including SIGTERM.
        if ((code !== 0 && code !== 130) || exitSignal !== null) {
          reject(
            new Error(`Server failed to stop gracefully (${code}, ${exitSignal})\n${this.logs}`),
          )
        } else resolve()
      })
      child.kill('SIGTERM')
    })
  }
}

export const test = base.extend<{ app: Application }>({
  // Playwright requires a destructuring pattern even when this fixture has no dependencies.
  // oxlint-disable-next-line no-empty-pattern
  app: async ({}, use, info) => {
    const app = new Application(await mkdtemp(join(tmpdir(), 'logspace-browser-')))
    try {
      await app.start()
      await use(app)
    } finally {
      try {
        await app.stop()
      } finally {
        if (info.status !== info.expectedStatus) {
          await info.attach('server.log', { body: app.logs, contentType: 'text/plain' })
        }
        await rm(app.directory, { recursive: true, force: true })
      }
    }
  },
  baseURL: async ({ app }, use) => {
    await use(app.origin)
  },
  context: async ({ context, app }, use) => {
    const external: string[] = []
    const errors: string[] = []
    context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)))
    await context.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === app.origin) return route.continue()
      external.push(route.request().url())
      return route.abort('blockedbyclient')
    })
    await use(context)
    expect(external, 'No browser request may leave the fixture origin').toEqual([])
    expect(errors, 'No uncaught browser errors').toEqual([])
  },
  page: async ({ page, app }, use) => {
    await page.goto('/admin/login')
    await page.getByLabel('Admin Password').fill(app.password)
    await page.getByRole('button', { name: 'Log in', exact: true }).click()
    await expect(page).toHaveURL(`${app.origin}/admin/config`)
    await page.getByLabel('Site title', { exact: true }).fill('Browser Test')
    await page.getByLabel('Site URL', { exact: true }).fill(app.origin)
    await page.getByLabel('Site description', { exact: true }).fill('Disposable browser test site')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Saved')
    await use(page)
  },
})
export { expect }

export async function openComposer(page: Page) {
  await page.goto(composePath)
  // Datastar takes the nonce off the page once it's running.
  await expect(page.locator('html')).not.toHaveAttribute('data-nonce')
  await expect(page.getByLabel('Caption', { exact: true })).toBeVisible()
}

export async function caption(page: Page, text: string) {
  await page.getByLabel('Caption', { exact: true }).fill(text)
  await expect(page.locator('#composer-preview')).toContainText(text)
}
