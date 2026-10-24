import { test, expect, openComposer, caption, composePath } from './fixtures.ts'
import type { Route } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const photo = fileURLToPath(new URL('../test/content/posts/drdp3ei6fd/hike-1.jpg', import.meta.url))

// Hold an actual server snapshot until a later UI action has completed. route.fetch() buffers
// the entire response, so use a streaming reader for this never-ending endpoint.
async function initialEvent(route: Route) {
  const controller = new AbortController()
  const url = route.request().url()
  // WebKit's intercepted request does not expose its session cookie. Forward the cookies
  // applicable to this fixture URL from the authenticated browser context instead.
  const cookies = await route.request().frame().page().context().cookies(url)
  const response = await fetch(url, {
    headers: {
      ...(await route.request().allHeaders()),
      cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '),
    },
    signal: controller.signal,
  })
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream'))
    throw new Error(
      `Expected a stream, received ${response.status} ${response.headers.get('content-type')} at ${response.url}`,
    )
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let body = ''
  try {
    while (!body.includes('event: datastar-patch-elements') || !body.endsWith('\n\n')) {
      const part = await reader.read()
      if (part.done) throw new Error('Stream ended before an event')
      body += decoder.decode(part.value, { stream: true })
    }
    return body
  } finally {
    controller.abort()
  }
}

for (const saved of [false, true]) {
  test(`typing before the initial stream snapshot survives (${saved ? 'saved' : 'unsaved'})`, async ({
    page,
  }) => {
    const captured = Promise.withResolvers<void>()
    const deliver = Promise.withResolvers<void>()
    if (!saved) {
      // Keep the route installed while the stream is held: removing interception rules can
      // release another pending request in Chromium.
      let firstPreview = true
      await page.route('**/admin/posts/new/preview', (route) => {
        if (!firstPreview) return route.continue()
        firstPreview = false
        return route.fulfill({ status: 500 })
      })
    }
    await page.route(
      '**/admin/posts/new/updates?*',
      async (route) => {
        const body = await initialEvent(route)
        captured.resolve()
        await deliver.promise
        await route.fulfill({ contentType: 'text/event-stream', body })
      },
      { times: 1 },
    )
    await openComposer(page, false)
    await captured.promise
    const id = await page.locator('form.composer input[name=post_id]').inputValue()
    const text = 'Typed before the first stream event'
    if (saved) await caption(page, text)
    else {
      await page.getByLabel('Caption', { exact: true }).fill(text)
      await expect(page.getByRole('alert')).toContainText('try again')
    }
    deliver.resolve()
    await expect(page.locator('html')).toHaveAttribute('data-browser-updates', /[1-9]/)
    await expect(page.getByLabel('Caption', { exact: true })).toHaveValue(text)
    await expect(page.locator('form.composer input[name=post_id]')).toHaveValue(id)
    await expect(page.locator('#composer-draft')).toHaveText('Saved')
  })
}

for (const replace of [false, true]) {
  test(`a delayed save cannot overwrite ${replace ? 'another post' : 'a newer edit'}’s defaults or preview`, async ({
    page,
    context,
  }) => {
    await openComposer(page)
    await caption(page, 'Original draft')
    const oldId = await page.locator('form.composer input[name=post_id]').inputValue()
    const captured = Promise.withResolvers<void>()
    const deliver = Promise.withResolvers<void>()
    await page.route(
      '**/admin/posts/new/preview',
      async (route) => {
        const response = await route.fetch()
        captured.resolve()
        await deliver.promise
        await route.fulfill({ response })
      },
      { times: 1 },
    )
    await page.getByLabel('Caption', { exact: true }).fill('Late save from the original post')
    await captured.promise
    const other = await context.newPage()
    await openComposer(other)
    if (replace) {
      await other.getByRole('button', { name: 'Discard', exact: true }).click()
      await other.getByRole('dialog').getByRole('button', { name: 'Discard', exact: true }).click()
      await expect(page.locator('form.composer input[name=post_id]')).not.toHaveValue(oldId)
    }
    await caption(other, 'Replacement draft')
    await expect(page.getByLabel('Caption', { exact: true })).toHaveValue('Replacement draft')
    await page.evaluate(() => {
      document.addEventListener('datastar-fetch', (event) => {
        if (
          event instanceof CustomEvent &&
          event.detail.type === 'finished' &&
          event.detail.el.dataset.request === 'preview'
        )
          document.documentElement.dataset.lateSaveFinished = 'true'
      })
    })
    deliver.resolve()
    await expect(page.locator('html')).toHaveAttribute('data-late-save-finished', 'true')
    await expect(page.locator('#composer-preview')).toContainText('Replacement draft')
    await expect
      .poll(() =>
        page
          .getByLabel('Caption', { exact: true })
          .evaluate((element) =>
            element instanceof HTMLTextAreaElement ? element.defaultValue : null,
          ),
      )
      .toBe('Replacement draft')
  })
}

test('failed uploads stay visible through previews and reconnects and can be retried', async ({
  page,
  context,
  app,
}, info) => {
  await openComposer(page)
  await caption(page, 'Keep my photo')
  const uploading = Promise.withResolvers<void>()
  const fail = Promise.withResolvers<void>()
  await page.route(
    '**/admin/posts/new/media',
    async (route) => {
      uploading.resolve()
      await fail.promise
      await route.abort('connectionreset')
    },
    { times: 1 },
  )
  await page.getByLabel('Add photos', { exact: true }).setInputFiles(photo)
  await uploading.promise
  const other = await context.newPage()
  await openComposer(other)
  await caption(other, 'Edited elsewhere while uploading')
  await expect(page.getByLabel('Caption', { exact: true })).toHaveValue(
    'Edited elsewhere while uploading',
  )
  fail.resolve()
  await expect(page.getByRole('alert')).toContainText('try again')
  await caption(page, 'Text saved after the upload failed')
  await expect(page.getByRole('alert')).toBeVisible()
  const previous = Number(await page.locator('html').getAttribute('data-browser-updates'))
  await app.restart()
  await expect
    .poll(async () => Number(await page.locator('html').getAttribute('data-browser-updates')))
    .toBeGreaterThan(previous)
  await expect(page.getByRole('button', { name: 'Retry media change' })).toBeVisible()
  expect(
    await page
      .getByLabel('Add photos', { exact: true })
      .evaluate((element) => (element instanceof HTMLInputElement ? element.files?.length : null)),
  ).toBe(1)
  await page.screenshot({ path: info.outputPath('media-retry.png') })
  await page.getByRole('button', { name: 'Retry media change' }).click()
  await expect(page.locator('#composer-media img')).toHaveCount(1)
  await expect(page.getByRole('alert')).toBeHidden()
  await page.reload()
  await expect(page.locator('#composer-media img')).toHaveCount(1)
  await expect(page.getByLabel('Caption', { exact: true })).toHaveValue(
    'Text saved after the upload failed',
  )
})

for (const committed of [false, true]) {
  test(`reconnect reconciles a lost publish response with no prior saves (${committed ? 'committed' : 'failed'})`, async ({
    page,
    context,
    app,
  }) => {
    await openComposer(page)
    await page.route('**/admin/posts/new/preview', (route) => route.abort('connectionreset'))
    await page.getByLabel('Caption', { exact: true }).fill('Text submitted for publication')
    await expect(page.getByRole('alert')).toContainText('try again')
    const oldId = await page.locator('form.composer input[name=post_id]').inputValue()
    await page.route(
      `**${composePath}`,
      async (route) => {
        if (committed) expect((await route.fetch()).status()).toBe(200)
        await route.abort('connectionreset')
      },
      { times: 1 },
    )
    await page.getByRole('button', { name: 'Post', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('try again')
    await expect(page.getByRole('button', { name: 'Post', exact: true })).toBeEnabled()
    await page.unroute('**/admin/posts/new/preview')
    const previous = Number(await page.locator('html').getAttribute('data-browser-updates'))
    await app.restart()
    await expect
      .poll(async () => Number(await page.locator('html').getAttribute('data-browser-updates')))
      .toBeGreaterThan(previous)
    await expect(page.getByLabel('Caption', { exact: true })).toHaveValue(
      committed ? '' : 'Text submitted for publication',
    )
    const other = await context.newPage()
    await openComposer(other)
    await expect(other.getByLabel('Caption', { exact: true })).toHaveValue(
      committed ? '' : 'Text submitted for publication',
    )
    expect((await page.request.get(`/posts/${oldId}`)).status()).toBe(committed ? 200 : 404)
    if (committed)
      await expect(page.locator('form.composer input[name=post_id]')).not.toHaveValue(oldId)
    else await expect(page.locator('form.composer input[name=post_id]')).toHaveValue(oldId)
  })
}

for (const failure of ['500', 'transport', 'validation'] as const) {
  test(`typing during a failed publish is saved (${failure})`, async ({ page }) => {
    await page.clock.install()
    await openComposer(page)
    if (failure !== 'validation') await caption(page, 'Saved before publishing')
    await page.clock.runFor(250)
    const captured = Promise.withResolvers<void>()
    const deliver = Promise.withResolvers<void>()
    await page.route(
      `**${composePath}`,
      async (route) => {
        const response = failure === 'validation' ? await route.fetch() : undefined
        captured.resolve()
        await deliver.promise
        if (response) await route.fulfill({ response })
        else if (failure === 'transport') await route.abort('connectionreset')
        else
          await route.fulfill({ status: 500, contentType: 'text/plain', body: 'Injected failure' })
      },
      { times: 1 },
    )
    await page.getByRole('button', { name: 'Post', exact: true }).click()
    await captured.promise
    await page.getByLabel('Caption', { exact: true }).fill('Typed while publishing')
    await page.clock.runFor(250)
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/preview') &&
        response.request().postData()?.includes('Typed while publishing') === true,
    )
    deliver.resolve()
    await saved
    await expect(page.getByRole('button', { name: 'Post', exact: true })).toBeEnabled()
    const savedHtml = await (await page.request.get(composePath)).text()
    expect(savedHtml).toContain('Typed while publishing')
    await expect(page.getByLabel('Caption', { exact: true })).toHaveValue('Typed while publishing')
  })
}

test('the update stream recovers after more than ten consecutive failures', async ({ page }) => {
  await page.clock.install()
  let attempts = 0
  await page.route('**/admin/posts/new/updates?*', (route) => {
    attempts++
    return attempts <= 12 ? route.abort('connectionreset') : route.continue()
  })
  await openComposer(page, false)
  for (let i = 1; i <= 12; i++) {
    await expect.poll(() => attempts).toBe(i)
    await page.clock.runFor(30_001)
  }
  await expect(page.locator('html')).toHaveAttribute('data-browser-updates', /[1-9]/)
  expect(attempts).toBe(13)
  await caption(page, 'Recovered after a long outage')
})

test('ordinary stream updates do not retry permanently broken images', async ({
  page,
  context,
  app,
}) => {
  await openComposer(page)
  await caption(page, 'Photo draft')
  await page.route('**/admin/posts/*/files/hike-1.jpg?*', (route) => {
    return route.fulfill({ status: 404 })
  })
  await page.getByLabel('Add photos', { exact: true }).setInputFiles(photo)
  await expect(page.locator('#composer-media img')).toHaveCount(1)
  await expect
    .poll(() =>
      page
        .locator('#composer-media img')
        .evaluate(
          (image) => image instanceof HTMLImageElement && image.complete && !image.naturalWidth,
        ),
    )
    .toBe(true)
  // Count failures on the retained composer tile. A newly rendered preview may legitimately
  // introduce an image of its own; it isn't an automatic retry of an existing broken element.
  await page.locator('#composer-media img').evaluate((image) => {
    image.addEventListener('error', () => {
      const html = document.documentElement
      html.dataset.mediaFailures = String(Number(html.dataset.mediaFailures ?? 0) + 1)
    })
  })
  const other = await context.newPage()
  await openComposer(other)
  for (const text of ['First remote edit', 'Second remote edit']) {
    await caption(other, text)
    await expect(page.getByLabel('Caption', { exact: true })).toHaveValue(text)
    await expect(page.locator('html')).not.toHaveAttribute('data-media-failures')
  }
  const previous = Number(await page.locator('html').getAttribute('data-browser-updates'))
  await app.restart()
  await expect
    .poll(async () => Number(await page.locator('html').getAttribute('data-browser-updates')))
    .toBeGreaterThan(previous)
  await expect(page.locator('html')).toHaveAttribute('data-media-failures', '1')
  await caption(other, 'Remote edit after reconnect')
  await expect(page.getByLabel('Caption', { exact: true })).toHaveValue(
    'Remote edit after reconnect',
  )
  await expect(page.locator('html')).toHaveAttribute('data-media-failures', '1')
})
