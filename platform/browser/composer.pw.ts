import { test, expect, openComposer, caption, composePath } from './fixtures.ts'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'

test('failed publishing preserves input and permits retry', async ({ page }, info) => {
  await openComposer(page)
  await caption(page, 'Keep this draft after a failure')
  await page.route(
    `**${composePath}`,
    (route) => route.fulfill({ status: 500, contentType: 'text/plain', body: 'Injected failure' }),
    { times: 1 },
  )
  const failed = page.waitForResponse(
    (response) => response.url().endsWith(composePath) && response.status() === 500,
  )
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  await failed

  await expect(page.getByRole('button', { name: 'Post', exact: true })).toBeEnabled()
  await expect(page.getByLabel('Caption', { exact: true })).toHaveValue(
    'Keep this draft after a failure',
  )
  await expect(page.getByRole('alert')).toContainText('try again')
  await page.screenshot({ path: info.outputPath('publish-failure.png') })
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(page).toHaveURL(/\/posts\/[a-z0-9]{10}$/)
  await expect(page.locator('main')).toContainText('Keep this draft after a failure')
})

const photo = fileURLToPath(new URL('../test/content/posts/drdp3ei6fd/hike-1.jpg', import.meta.url))
const secondPhoto = fileURLToPath(
  new URL('../test/content/posts/drdp3ei6fd/hike-2.jpg', import.meta.url),
)
const video = fileURLToPath(new URL('../test/content/posts/steq6e0rsh/flower.mp4', import.meta.url))

async function upload(
  page: Page,
  label: string,
  files: string | string[] | { name: string; mimeType: string; buffer: Buffer },
) {
  const response = page.waitForResponse((response) => response.url().endsWith('/media'))
  await page.getByLabel(label, { exact: true }).setInputFiles(files)
  expect((await response).status()).toBe(200)
  await expect(page.getByRole('button', { name: 'Post', exact: true })).toBeEnabled()
  await expect(page.locator('#composer-draft')).toHaveText('Saved')
}

async function publish(page: Page) {
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(page).toHaveURL(/\/posts\/[a-z0-9]{10}$/)
}

async function loadedImages(page: Page, selector: string, count: number) {
  await expect(page.locator(selector)).toHaveCount(count)
  await expect
    .poll(() =>
      page
        .locator(selector)
        .evaluateAll((images) =>
          images.every(
            (image) =>
              image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
          ),
        ),
    )
    .toBe(true)
}

test('text, location, keyboard submission, and public content', async ({ page }) => {
  await openComposer(page)
  await expect(page.getByLabel('Caption', { exact: true })).toBeFocused()
  await caption(page, 'A text post from the browser')
  await page.getByRole('button', { name: 'Add location', exact: true }).click()
  await expect(page.getByLabel('City', { exact: true })).toBeFocused()
  await page.getByLabel('City', { exact: true }).fill('Hanoi')
  await expect(page.locator('#composer-preview')).toContainText('Hanoi')
  await page.getByLabel('Caption', { exact: true }).press('Control+Enter')
  await expect(page).toHaveURL(/\/posts\/[a-z0-9]{10}$/)
  await expect(page.locator('main')).toContainText('A text post from the browser')
  await expect(page.locator('main')).toContainText('Hanoi')
  await page.goto('/')
  await expect(page.locator('main')).toContainText('A text post from the browser')
})

test('photo draft survives edits and reload before publication', async ({ page }) => {
  await openComposer(page)
  await caption(page, 'A draft with photos')
  await upload(page, 'Add photos', [photo, secondPhoto])
  await loadedImages(page, '#composer-media img', 2)
  await caption(page, 'Edited photo caption')
  await page.reload()
  await expect(page.getByLabel('Caption', { exact: true })).toHaveValue('Edited photo caption')
  await loadedImages(page, '#composer-media img', 2)
  await page.getByRole('button', { name: 'Remove hike-2.jpg', exact: true }).click()
  await loadedImages(page, '#composer-media img', 1)
  await publish(page)
  await loadedImages(page, 'main article img', 1)
  await expect(page.locator('main')).toContainText('Edited photo caption')
  const image = await page.locator('main article img').getAttribute('src')
  expect(image).toContain('/posts/')
  // Public media remains available without the admin cookie.
  expect((await page.request.get(image ?? '')).status()).toBe(200)
})

test('video and poster publish with playable public media', async ({ page }) => {
  await openComposer(page)
  await caption(page, 'Flower video')
  await upload(page, 'Add a video', video)
  await expect(page.locator('#composer-media video')).toHaveAttribute('src', /flower.mp4/)
  await upload(page, 'Add a poster image', photo)
  await page.reload()
  await expect(page.getByLabel('Caption', { exact: true })).toHaveValue('Flower video')
  await expect(page.locator('#composer-media video')).toHaveAttribute('poster', /hike-1.jpg/)
  await publish(page)
  await expect(page.locator('main video')).toHaveAttribute('poster', /hike-1.jpg/)
  await expect
    .poll(() =>
      page
        .locator('main video')
        .evaluate((element) => (element instanceof HTMLVideoElement ? element.readyState : 0)),
    )
    .toBeGreaterThanOrEqual(1)
})

test('article, cover, and referenced files survive edits and publish', async ({ page }) => {
  await openComposer(page)
  await upload(page, 'Add an article from a Markdown file', {
    name: 'journey.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      '# Browser article\n\nA paragraph with **emphasis**.\n\n![On the trail](hike-1.jpg)',
    ),
  })
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Browser article')
  await page.getByLabel('Title', { exact: true }).fill('Edited article title')
  await page.getByLabel('Summary (optional)', { exact: true }).fill('An edited summary')
  await expect(page.locator('#composer-preview')).toContainText('An edited summary')
  await upload(page, 'Upload files', photo)
  await upload(page, 'Add a cover image', secondPhoto)
  await page.reload()
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Edited article title')
  await expect(page.getByLabel('Summary (optional)', { exact: true })).toHaveValue(
    'An edited summary',
  )
  await expect(page.locator('#composer-media')).not.toContainText('isn’t uploaded')
  await publish(page)
  await expect(page.getByRole('heading', { name: 'Edited article title' })).toBeVisible()
  await expect(page.locator('main strong')).toHaveText('emphasis')
  await loadedImages(page, 'main article img', 2)
})

test('rejected empty publication allows editing and retry', async ({ page }) => {
  await openComposer(page)
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Write something')
  await expect(page.getByRole('button', { name: 'Post', exact: true })).toBeEnabled()
  await caption(page, 'Now there is content')
  await publish(page)
})

test('interrupted upload preserves chosen files and text for an explicit retry', async ({
  page,
}) => {
  await openComposer(page)
  await caption(page, 'Keep my selected photo')
  await page.route('**/admin/posts/new/media', (route) => route.abort('connectionreset'), {
    times: 1,
  })
  const interrupted = page.waitForEvent('requestfailed', {
    predicate: (request) => request.url().endsWith('/media'),
  })
  await page.getByLabel('Add photos', { exact: true }).setInputFiles(photo)
  await interrupted
  await expect(page.getByRole('alert')).toContainText('try again')
  await expect(page.getByRole('button', { name: 'Post', exact: true })).toBeEnabled()
  await expect(page.getByLabel('Caption', { exact: true })).toHaveValue('Keep my selected photo')
  expect(
    await page
      .getByLabel('Add photos', { exact: true })
      .evaluate((element) =>
        element instanceof HTMLInputElement ? element.files?.[0]?.name : undefined,
      ),
  ).toBe('hike-1.jpg')
  // Posting the retained form retries the chosen file; there is no need to select it again.
  await publish(page)
  await loadedImages(page, 'main article img', 1)
  await expect(page.locator('main')).toContainText('Keep my selected photo')
})

test('transport failure while publishing allows retry without reloading', async ({ page }) => {
  await openComposer(page)
  await caption(page, 'Network failure draft')
  await page.route(`**${composePath}`, (route) => route.abort('connectionreset'), { times: 1 })
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('try again')
  await expect(page.getByRole('button', { name: 'Post', exact: true })).toBeEnabled()
  await expect(page.getByLabel('Caption', { exact: true })).toHaveValue('Network failure draft')
  await publish(page)
})

test('Post stays disabled while the browser goes to the published post', async ({ page }) => {
  // Marks the publish request settled, after its promise callbacks (a task after the event).
  await page.addInitScript(() => {
    document.addEventListener('datastar-fetch', (event) => {
      if (
        event instanceof CustomEvent &&
        event.detail.type === 'finished' &&
        event.detail.el instanceof HTMLFormElement
      ) {
        setTimeout(() => (document.documentElement.dataset.publishSettled = 'true'))
      }
    })
  })
  await openComposer(page)
  await caption(page, 'Published only once')
  // Staying on the page when it's asked to leave keeps the composer as it was meanwhile.
  await page.evaluate(() => addEventListener('beforeunload', (event) => event.preventDefault()))
  const leaving = page.waitForEvent('dialog')
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  const dialog = await leaving
  expect(dialog.type()).toBe('beforeunload')
  await dialog.dismiss()
  await expect(page.locator('html')).toHaveAttribute('data-publish-settled', 'true')
  await expect(page.getByRole('button', { name: 'Post', exact: true })).toBeDisabled()
})

test('two tabs propagate edits, preserve dialog focus, discard, and publish', async ({
  page,
  context,
}) => {
  await openComposer(page)
  await caption(page, 'Shared draft')
  await page.getByRole('button', { name: 'Add location', exact: true }).click()
  await page.getByLabel('City', { exact: true }).fill('Hanoi')
  await expect(page.locator('#composer-preview')).toContainText('Hanoi')
  await upload(page, 'Add photos', photo)
  const other = await context.newPage()
  await openComposer(other)
  await expect(other.getByLabel('Caption', { exact: true })).toHaveValue('Shared draft')
  await loadedImages(other, '#composer-media img', 1)
  // Safari does not focus buttons on pointer click; open with the keyboard to test focus return.
  await other.getByRole('button', { name: 'Discard', exact: true }).focus()
  await other.getByRole('button', { name: 'Discard', exact: true }).press('Enter')
  await expect(other.getByRole('dialog')).toBeVisible()
  await expect(other.getByRole('button', { name: 'Keep writing', exact: true })).toBeFocused()
  await caption(page, 'Updated from the first tab')
  await expect(other.getByLabel('Caption', { exact: true })).toHaveValue(
    'Updated from the first tab',
  )
  await expect(other.getByRole('dialog')).toBeVisible()
  await other.keyboard.press('Escape')
  await expect(other.getByRole('dialog')).not.toBeVisible()
  await expect(other.getByRole('button', { name: 'Discard', exact: true })).toBeFocused()
  await other.getByRole('button', { name: 'Discard', exact: true }).click()
  await other.getByRole('dialog').getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(other.getByLabel('Caption', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Caption', { exact: true })).toHaveValue('')
  await expect(page.locator('#composer-media img')).toHaveCount(0)
  await expect(page.getByLabel('City', { exact: true })).toHaveValue('')
  await caption(page, 'The replacement draft')
  await expect(other.getByLabel('Caption', { exact: true })).toHaveValue('The replacement draft')
  await publish(page)
  await expect(other.getByLabel('Caption', { exact: true })).toHaveValue('')
  await expect(other.locator('#composer-draft')).toHaveText('')
})

for (const action of ['discard', 'publish'] as const) {
  test(`a stale tab cannot resurrect or alter media after ${action}`, async ({ page, context }) => {
    await openComposer(page)
    await caption(page, 'Original shared media')
    await upload(page, 'Add photos', photo)
    const id = await page.locator('input[name=post_id]').first().inputValue()
    const stale = await context.newPage()
    // A completed 204 stream models a tab that no longer receives updates, without modifying
    // Datastar or sending fabricated form data. Subsequent actions are real UI submissions.
    await stale.route('**/admin/posts/new/updates?*', (route) => route.fulfill({ status: 204 }))
    await openComposer(stale, false)
    await loadedImages(stale, '#composer-media img', 1)
    if (action === 'discard') {
      await page.getByRole('button', { name: 'Discard', exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Discard', exact: true }).click()
      await expect(page.getByLabel('Caption', { exact: true })).toHaveValue('')
    } else {
      await publish(page)
    }
    await stale.getByRole('button', { name: 'Remove hike-1.jpg', exact: true }).click()
    await expect(stale.getByRole('alert')).toContainText(
      action === 'discard' ? 'discarded' : 'published',
    )
    await stale.getByLabel('Caption', { exact: true }).fill('Late stale text')
    await expect(stale.locator('#composer-draft')).toHaveText('Not saved')
    await stale.getByRole('button', { name: 'Post', exact: true }).click()
    await expect(stale.getByRole('alert')).toContainText(
      action === 'discard' ? 'discarded' : 'published',
    )
    const response = await page.request.get(`/posts/${id}/hike-1.jpg`)
    if (action === 'publish') {
      expect(response.status()).toBe(200)
      expect(await response.body()).toEqual(await readFile(photo))
    } else {
      expect(response.status()).toBe(404)
    }
    await openComposer(page)
    await expect(page.getByLabel('Caption', { exact: true })).toHaveValue('')
    await expect(page.locator('#composer-media img')).toHaveCount(0)
  })
}

test('update stream reconnects after abrupt application restart', async ({
  page,
  context,
  app,
}) => {
  await openComposer(page)
  await caption(page, 'Persistent draft across restart')
  // Force the image to fail before restarting, rather than racing the process kill against
  // its download. A successful SSE reconnect must also recover this retained image element.
  await page.route('**/admin/posts/*/files/hike-1.jpg?*', (route) => route.abort('connectionreset'))
  await upload(page, 'Add photos', photo)
  await expect
    .poll(() =>
      page
        .locator('#composer-media img')
        .evaluate(
          (element) =>
            element instanceof HTMLImageElement && element.complete && element.naturalWidth === 0,
        ),
    )
    .toBe(true)
  await page.unroute('**/admin/posts/*/files/hike-1.jpg?*')
  const previous = Number(await page.locator('html').getAttribute('data-browser-updates'))
  await app.restart()
  await expect
    .poll(async () => Number(await page.locator('html').getAttribute('data-browser-updates')))
    .toBeGreaterThan(previous)
  await expect(page.getByLabel('Caption', { exact: true })).toHaveValue(
    'Persistent draft across restart',
  )
  await loadedImages(page, '#composer-media img', 1)
  const other = await context.newPage()
  await openComposer(other)
  await caption(other, 'Updated after reconnect')
  await expect(page.getByLabel('Caption', { exact: true })).toHaveValue('Updated after reconnect')
  await publish(page)
  await loadedImages(page, 'main article img', 1)
})

test('what is typed during an outage survives the reconnect and is saved', async ({
  page,
  context,
  app,
}) => {
  await openComposer(page)
  await caption(page, 'Saved before the outage')
  const previous = Number(await page.locator('html').getAttribute('data-browser-updates'))
  await app.stop('SIGKILL')
  const failed = page.waitForEvent('requestfailed', {
    predicate: (request) => request.url().endsWith('/preview'),
  })
  await page.getByLabel('Caption', { exact: true }).fill('Typed during the outage')
  await failed
  await expect(page.getByRole('alert')).toContainText('try again')

  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/preview') &&
      response.request().postData()?.includes('Typed during the outage') === true,
  )
  await app.start()
  await expect
    .poll(async () => Number(await page.locator('html').getAttribute('data-browser-updates')))
    .toBeGreaterThan(previous)
  expect((await saved).status()).toBe(200)
  await expect(page.getByLabel('Caption', { exact: true })).toHaveValue('Typed during the outage')
  await expect(page.locator('#composer-draft')).toHaveText('Saved')
  await expect(page.getByRole('alert')).toBeHidden()

  const other = await context.newPage()
  await openComposer(other)
  await expect(other.getByLabel('Caption', { exact: true })).toHaveValue('Typed during the outage')
  // Saved text still gives way to another tab's change.
  await caption(other, 'Changed in another tab')
  await expect(page.getByLabel('Caption', { exact: true })).toHaveValue('Changed in another tab')
})

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })
  test('ordinary form publishes text and a selected photo', async ({ page }) => {
    await page.goto(composePath)
    await page.getByLabel('Caption', { exact: true }).fill('Plain HTML publication')
    await page.getByLabel('City', { exact: true }).fill('Hanoi')
    await page.getByLabel('Add photos', { exact: true }).setInputFiles(photo)
    await publish(page)
    await expect(page.locator('main')).toContainText('Plain HTML publication')
    await expect(page.locator('main')).toContainText('Hanoi')
    await loadedImages(page, 'main article img', 1)
  })
})

test('an interrupted update request reconnects to the live draft', async ({ page, context }) => {
  await openComposer(page)
  await caption(page, 'Draft before reconnect')
  const other = await context.newPage()
  await other.route('**/admin/posts/new/updates?*', (route) => route.abort('connectionreset'), {
    times: 1,
  })
  const interrupted = other.waitForEvent('requestfailed', {
    predicate: (request) => request.url().includes('/updates?'),
  })
  await other.goto(composePath)
  await interrupted
  await expect(other.locator('html')).toHaveAttribute('data-browser-updates', /[1-9]/)
  await caption(page, 'Draft after reconnect')
  await expect(other.getByLabel('Caption', { exact: true })).toHaveValue('Draft after reconnect')
})

test('a lost publish response cannot duplicate a post or overwrite its media on retry', async ({
  page,
}) => {
  await openComposer(page)
  await caption(page, 'Published despite a lost response')
  await upload(page, 'Add photos', photo)
  const id = await page.locator('input[name=post_id]').first().inputValue()
  await page.route(
    `**${composePath}`,
    async (route) => {
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      await route.abort('connectionreset')
    },
    { times: 1 },
  )
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('try again')
  await expect(page.getByRole('button', { name: 'Post', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('published')
  await page.goto('/')
  await expect(page.locator('main article')).toHaveCount(1)
  await expect(page.locator('main')).toContainText('Published despite a lost response')
  const media = await page.request.get(`/posts/${id}/hike-1.jpg`)
  expect(media.status()).toBe(200)
  expect(await media.body()).toEqual(await readFile(photo))
})

test('another tab can restore a location after it was removed locally', async ({
  page,
  context,
}) => {
  await openComposer(page)
  await caption(page, 'Location changes')
  await page.getByRole('button', { name: 'Add location', exact: true }).click()
  await page.getByLabel('City', { exact: true }).fill('Hanoi')
  await expect(page.locator('#composer-preview')).toContainText('Hanoi')
  const other = await context.newPage()
  await openComposer(other)
  await expect(other.getByLabel('City', { exact: true })).toHaveValue('Hanoi')
  await other.getByRole('button', { name: 'Remove location', exact: true }).click()
  await expect(page.getByLabel('City', { exact: true })).toHaveValue('')
  await page.getByRole('button', { name: 'Add location', exact: true }).click()
  await page.getByLabel('City', { exact: true }).fill('Hanoi')
  await expect(page.locator('#composer-preview')).toContainText('Hanoi')
  await expect(other.getByLabel('City', { exact: true })).toHaveValue('Hanoi')
})
