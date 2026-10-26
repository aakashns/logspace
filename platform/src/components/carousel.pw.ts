// A post's photos (see PhotoCarousel in post.tsx): the arrows and dots in the feed, and the
// lightbox they open as, with the arrow keys and the keyboard's focus kept in it.
import { fileURLToPath } from 'node:url'

import { test, expect, openComposer } from '../../browser/fixtures.ts'

const photos = ['hike-1.jpg', 'hike-2.jpg', 'hike-3.jpg'].map((name) =>
  fileURLToPath(new URL(`../../test/content/posts/drdp3ei6fd/${name}`, import.meta.url)),
)

test('the arrows step through the photos, and the arrow keys do in the lightbox', async ({
  page,
}) => {
  await openComposer(page)
  let uploaded = page.waitForResponse((response) => response.url().endsWith('/media'))
  await page.getByLabel('Add photos', { exact: true }).setInputFiles(photos)
  expect((await uploaded).status()).toBe(200)
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(page).toHaveURL(/\/posts\/[a-z0-9]{10}$/)
  await page.goto('/')
  // Datastar takes the nonce off the page once it's running.
  await expect(page.locator('html')).not.toHaveAttribute('data-nonce')

  let carousel = page.locator('.carousel')
  let index = () => carousel.evaluate((el) => getComputedStyle(el).getPropertyValue('--index'))
  let open = () => carousel.evaluate((el) => el.matches(':modal'))
  await carousel.getByRole('button', { name: 'Next photo' }).click()
  await expect.poll(index).toBe('1')
  let frame = page.locator('.carousel-frame')
  let height = (await frame.boundingBox())?.height

  // Clicking the photo opens the lightbox at it, once Datastar has put it back there (its
  // listener runs before this one). The photo's space stays in the page, the photos are sized
  // for the screen, and Tab stays in the lightbox.
  let toggled = carousel.evaluate(
    (el) => new Promise((resolve) => el.addEventListener('toggle', resolve, { once: true })),
  )
  await carousel.locator('.carousel-slide').nth(1).click()
  await toggled
  await expect.poll(open).toBe(true)
  await expect.poll(index).toBe('1')
  expect((await frame.boundingBox())?.height).toBe(height)
  await expect(carousel.locator('img').first()).toHaveAttribute('sizes', '100vw')
  await expect(carousel.getByRole('button', { name: 'Close' })).toBeFocused()
  // The page behind is inert. (WebKit's Tab skips buttons, so it leaves the page instead.)
  for (let tab = 0; tab < 5; tab++) await page.keyboard.press('Tab')
  expect(
    await carousel.evaluate(
      (el) => el.contains(document.activeElement) || document.activeElement === document.body,
    ),
  ).toBe(true)
  await page.keyboard.press('ArrowRight')
  await expect.poll(index).toBe('2')
  await page.keyboard.press('ArrowLeft')
  await expect.poll(index).toBe('1')

  // Escape closes it, at the same photo, without leaving the feed.
  await page.keyboard.press('Escape')
  await expect.poll(open).toBe(false)
  await expect.poll(index).toBe('1')
  expect(new URL(page.url()).pathname).toBe('/')
})
