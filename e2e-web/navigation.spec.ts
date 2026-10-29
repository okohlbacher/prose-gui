// The four views: the top bar and the shortcuts ⌘/Ctrl ⇧ 1–4; the hash follows.
import { MOD, expect, openFixture, test } from './fixtures'
import type { Page } from '@playwright/test'

const link = (page: Page, label: string) => page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: label, exact: true })

const views = [
  { id: 'search', hash: /#\/search$/, label: 'New search' },
  { id: 'results', hash: /#\/results/, label: 'Results' },
  { id: 'history', hash: /#\/history$/, label: 'History' },
  { id: 'help', hash: /#\/help/, label: 'Help' },
] as const

test('the top bar switches between the views', async ({ page }) => {
  await page.goto('/#/search')
  for (const v of [...views, views[0]]) {
    await link(page, v.label).click()
    await expect(page).toHaveURL(v.hash)
    await expect(link(page, v.label)).toHaveAttribute('aria-current', 'page')
    await expect(page.getByTestId(`view-${v.id}`)).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: v.label, exact: true })).toBeVisible()
  }
})

test('⌘/Ctrl ⇧ 1–4 switch the views', async ({ page }) => {
  await page.goto('/#/search')
  await expect(link(page, 'New search')).toHaveAttribute('aria-current', 'page')
  for (const [i, v] of [views[3], views[2], views[1], views[0]].map((v) => [views.indexOf(v) + 1, v] as const)) {
    await page.keyboard.press(`${MOD}+Shift+Digit${i}`)
    await expect(page).toHaveURL(v.hash)
    await expect(link(page, v.label)).toHaveAttribute('aria-current', 'page')
    await expect(page.getByTestId(`view-${v.id}`)).toBeVisible()
  }
})

test('Results without a result says so; with one, ⌘/Ctrl ⇧ 2 comes back to it', async ({ page }) => {
  await page.goto('/#/results')
  await expect(page.getByTestId('results-none')).toBeVisible()
  await openFixture(page)
  await page.keyboard.press(`${MOD}+Shift+Digit4`)
  await expect(page).toHaveURL(/#\/help/)
  await page.keyboard.press(`${MOD}+Shift+Digit2`)
  await expect(page).toHaveURL(/#\/results\/100-0$/)
  await expect(page.getByTestId('results-tabs')).toBeVisible()
})

test('History lists the opened search and opens it again', async ({ page }) => {
  await openFixture(page)
  await link(page, 'History').click()
  const row = page.getByTestId('history-row')
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('Ecoli_1.mzML')
  await expect(row).toContainText('154')
  await row.getByRole('button', { name: 'Open Ecoli', exact: true }).click()
  await expect(page).toHaveURL(/#\/results\/100-0$/)
  await expect(page.getByTestId('results-tabs')).toBeVisible()
})

test('"?" opens the keyboard shortcuts', async ({ page }) => {
  await page.goto('/#/search')
  await page.locator('body').press('?')
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('New search, Results, History, Help')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})
