// The components on /dev/design that the browser and Datastar run: the dropdown menu's keyboard and
// pointer behavior, its checkbox and radio items' signals, and the dialog.
import { test, expect } from '../../../../browser/fixtures.ts'

test.beforeEach(async ({ page }) => {
  await page.goto('/dev/design')
  // Datastar takes the nonce off the page once it's running.
  await expect(page.locator('html')).not.toHaveAttribute('data-nonce')
})

test('a menu opened from the keyboard focuses its first item, and arrow keys move', async ({
  page,
}) => {
  let trigger = page.locator('#light-menu-trigger')
  let menu = page.locator('#light-menu')
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Profile' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Settings' })).toBeFocused()
  // The disabled item is skipped.
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Status bar' })).toBeFocused()
  await page.keyboard.press('End')
  await expect(menu.getByRole('menuitem', { name: 'Delete' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Profile' })).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(menu.getByRole('menuitem', { name: 'Delete' })).toBeFocused()
  // The disabled link is skipped too.
  await page.keyboard.press('ArrowUp')
  await expect(menu.getByRole('menuitem', { name: 'GitHub' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('a menu sits below its trigger, and closes on Tab', async ({ page }) => {
  let trigger = page.locator('#light-menu-trigger')
  let menu = page.locator('#light-menu')
  await trigger.click()
  await expect(menu).toBeVisible()
  // 4px below its trigger, lined up with its start, once it has zoomed in.
  let triggerBox = await trigger.boundingBox()
  await expect
    .poll(async () => {
      let box = await menu.boundingBox()
      return [Math.round(box?.x ?? 0), Math.round(box?.y ?? 0)]
    })
    .toEqual([
      Math.round(triggerBox?.x ?? -1),
      Math.round((triggerBox?.y ?? 0) + (triggerBox?.height ?? 0) + 4),
    ])
  // Opened by a click, the menu has focus, so arrow keys reach its items.
  await expect(menu).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Profile' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(menu).toBeHidden()
})

test('checkbox and radio items set their signals and stay open; other items close', async ({
  page,
}) => {
  let menu = page.locator('#light-menu')
  let note = page
    .locator('.design-panel[data-scheme=light] .design-note')
    .filter({ hasText: 'Status bar' })
  await page.locator('#light-menu-trigger').click()
  let statusBar = menu.getByRole('menuitemcheckbox', { name: 'Status bar' })
  await expect(statusBar).toHaveAttribute('aria-checked', 'true')
  await statusBar.click()
  await expect(statusBar).toHaveAttribute('aria-checked', 'false')
  await menu.getByRole('menuitemradio', { name: 'Right' }).click()
  await expect(menu.getByRole('menuitemradio', { name: 'Right' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await expect(menu.getByRole('menuitemradio', { name: 'Bottom' })).toHaveAttribute(
    'aria-checked',
    'false',
  )
  await expect(menu).toBeVisible()
  await expect(note).toHaveText('Status bar off, activity bar off, panel at the right.')
  // Hovering an item focuses it, so one item is highlighted at a time.
  await menu.getByRole('menuitem', { name: 'Settings' }).hover()
  await expect(menu.getByRole('menuitem', { name: 'Settings' })).toBeFocused()
  await menu.getByRole('menuitem', { name: 'Settings' }).click()
  await expect(menu).toBeHidden()
})

test('the dialog opens as a modal, focuses its first field, and closes', async ({ page }) => {
  let trigger = page.getByRole('button', { name: 'Edit profile' }).first()
  let dialog = page.getByRole('dialog', { name: 'Edit profile' })
  // From the keyboard: Safari doesn't focus a button that's clicked, so a click would leave no
  // trigger to give focus back to.
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAccessibleDescription(
    'Make changes to your profile here. Save when you’re done.',
  )
  await expect(dialog.getByLabel('Name', { exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
  await trigger.click()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toBeHidden()
  await trigger.click()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
})

test('a disabled link can’t be followed by a click or the keyboard', async ({ page }) => {
  let link = page.getByRole('link', { name: 'Disabled link' }).first()
  await expect(link).toHaveAttribute('aria-disabled', 'true')
  await expect(link).not.toHaveAttribute('href')
  // A click where it is goes nowhere.
  let box = await link.boundingBox()
  await page.mouse.click((box?.x ?? 0) + 10, (box?.y ?? 0) + 10)
  await expect(page).toHaveURL(/\/dev\/design$/)
  // It can't take focus (so Tab passes it), and Enter has nothing to follow. (WebKit's Tab skips
  // links and buttons on macOS, so focus is tried directly.)
  expect(await link.evaluate((el) => (el.focus(), document.activeElement === el))).toBe(false)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/dev\/design$/)

  // In a menu, a click on it leaves the menu open and the page where it is.
  let menu = page.locator('#light-menu')
  await page.locator('#light-menu-trigger').click()
  let item = menu.getByRole('menuitem', { name: 'Changelog (disabled)' })
  await expect(item).toHaveAttribute('aria-disabled', 'true')
  box = await item.boundingBox()
  await page.mouse.click((box?.x ?? 0) + 40, (box?.y ?? 0) + 10)
  await expect(menu).toBeVisible()
  await expect(page).toHaveURL(/\/dev\/design$/)
  await expect(item).not.toBeFocused()
})
