import { test, expect, openComposer, caption, composePath } from './fixtures.ts'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'

const photo = fileURLToPath(new URL('../test/content/posts/drdp3ei6fd/hike-1.jpg', import.meta.url))
const secondPhoto = fileURLToPath(
  new URL('../test/content/posts/drdp3ei6fd/hike-2.jpg', import.meta.url),
)
const video = fileURLToPath(new URL('../test/content/posts/steq6e0rsh/flower.mp4', import.meta.url))

async function upload(page: Page, label: string, files: string | string[]) {
  const response = page.waitForResponse((response) => response.url().endsWith('/media'))
  await page.getByLabel(label, { exact: true }).setInputFiles(files)
  expect((await response).status()).toBe(200)
  await expect(page.getByRole('button', { name: 'Post', exact: true })).toBeEnabled()
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

test('a text post, previewed as it’s typed', async ({ page }) => {
  await openComposer(page)
  await expect(page.getByLabel('Caption', { exact: true })).toBeFocused()
  await caption(page, 'A text post from the browser')
  await publish(page)
  await expect(page.locator('main')).toContainText('A text post from the browser')
  await page.goto('/')
  await expect(page.locator('main')).toContainText('A text post from the browser')
})

test('photos upload as they’re chosen, and one can be taken out', async ({ page }) => {
  await openComposer(page)
  await caption(page, 'Two photos, then one')
  await upload(page, 'Add photos', [photo, secondPhoto])
  await loadedImages(page, '#composer-media img', 2)
  await loadedImages(page, '#composer-preview img', 2)
  await page.getByRole('button', { name: 'Remove hike-2.jpg', exact: true }).click()
  await loadedImages(page, '#composer-media img', 1)
  await publish(page)
  await loadedImages(page, 'main article img', 1)
  await expect(page.locator('main')).toContainText('Two photos, then one')
  // Public media is served without the admin cookie.
  const image = await page.locator('main article img').getAttribute('src')
  expect((await page.request.get(image ?? '')).status()).toBe(200)
})

test('Post waits for an upload to finish', async ({ page }) => {
  await openComposer(page)
  const held = Promise.withResolvers<void>()
  await page.route('**/admin/posts/media', async (route) => {
    await held.promise
    await route.continue()
  })
  await page.getByLabel('Add photos', { exact: true }).setInputFiles(photo)
  await expect(page.getByRole('status').filter({ hasText: 'Uploading' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Post', exact: true })).toBeDisabled()
  held.resolve()
  await loadedImages(page, '#composer-media img', 1)
  await expect(page.getByRole('button', { name: 'Post', exact: true })).toBeEnabled()
  await publish(page)
  await loadedImages(page, 'main article img', 1)
})

test('a video and its poster publish with playable public media', async ({ page }) => {
  await openComposer(page)
  await caption(page, 'Flower video')
  await upload(page, 'Add a video', video)
  await expect(page.locator('#composer-media video')).toHaveAttribute('src', /flower.mp4/)
  // With a video, the photo button adds its poster.
  await upload(page, 'Add photos', photo)
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

test('an empty post is refused, and posts once it’s written', async ({ page }) => {
  await openComposer(page)
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Write something')
  await caption(page, 'Now there is content')
  await publish(page)
})

test('an edit changes nothing until it’s saved, and × goes back to /admin', async ({ page }) => {
  await openComposer(page)
  await caption(page, 'Before the edit')
  await upload(page, 'Add photos', [photo, secondPhoto])
  await publish(page)
  const post = page.url()

  await page.goto(`${new URL(post).pathname.replace('/posts/', '/admin/posts/')}/edit`)
  await expect(page.getByRole('heading', { name: 'Edit Post' })).toBeVisible()
  await expect(page.getByLabel('Caption', { exact: true })).toHaveValue('Before the edit')
  await loadedImages(page, '#composer-media img', 2)
  await caption(page, 'After the edit')
  await page.getByRole('button', { name: 'Remove hike-2.jpg', exact: true }).click()
  await loadedImages(page, '#composer-media img', 1)
  // Closing it leaves the post as it was.
  await page.getByRole('button', { name: 'Revert changes', exact: true }).click()
  await expect(page).toHaveURL(/\/admin$/)
  await page.goto(post)
  await expect(page.locator('main')).toContainText('Before the edit')
  await loadedImages(page, 'main article img', 2)

  await page.goto(`${new URL(post).pathname.replace('/posts/', '/admin/posts/')}/edit`)
  await caption(page, 'After the edit')
  await page.getByRole('button', { name: 'Remove hike-2.jpg', exact: true }).click()
  await loadedImages(page, '#composer-media img', 1)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page).toHaveURL(post)
  await expect(page.locator('main')).toContainText('After the edit')
  await loadedImages(page, 'main article img', 1)
})

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })
  test('the form publishes text and a chosen photo', async ({ page }) => {
    await page.goto(composePath)
    await page.getByLabel('Caption', { exact: true }).fill('Plain HTML publication')
    await page.getByLabel('Add photos', { exact: true }).setInputFiles(photo)
    await publish(page)
    await expect(page.locator('main')).toContainText('Plain HTML publication')
    await loadedImages(page, 'main article img', 1)
  })
})
