// New search in the browser: the settings summary and Advanced settings, a "?" and its way into Help, the presets,
// the database card's organisms and the NCBI search box.
import { expect, test } from './fixtures'

test.beforeEach(async ({ page }) => {
  await page.goto('/#/search')
  await expect(page.getByRole('heading', { level: 1, name: 'New search' })).toBeVisible()
})

test('the settings summary, and Advanced settings open and close', async ({ page }) => {
  const summary = page.getByTestId('settings-summary')
  await expect(summary).toContainText('Trypsin/P')
  await expect(summary).toContainText('ppm precursor')
  const toggle = page.getByRole('button', { name: 'Advanced settings' })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('advanced-settings')).toBeHidden()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByTestId('advanced-settings')).toBeVisible()
  await expect(summary).toBeHidden()
  await expect(page.locator('#enzyme')).toBeVisible()
  await toggle.click()
  await expect(page.getByTestId('advanced-settings')).toBeHidden()
  await expect(summary).toBeVisible()
})

test('a "?" opens its explanation, and "More in Help ›" the setting in Help', async ({ page }) => {
  await page.getByRole('button', { name: 'What is PSM FDR?' }).first().click()
  const popover = page.locator('[data-slot="popover-content"]')
  await expect(popover).toBeVisible()
  await expect(popover).toContainText('false discovery rate')
  await popover.getByRole('button', { name: 'More in Help ›' }).click()
  await expect(page).toHaveURL(/#\/help\/settings$/)
  await expect(page.getByTestId('help-page-settings')).toHaveAttribute('aria-current', 'page')
  const section = page.locator('#help-psmFdr')
  await expect(section).toBeInViewport()
  await expect(section).toContainText('PSM FDR')
})

test('choosing a preset changes the settings', async ({ page }) => {
  const summary = page.getByTestId('settings-summary')
  const before = await summary.textContent()
  await page.locator('#preset').click()
  await page.getByRole('option', { name: 'Ion trap CID · tryptic' }).click()
  await expect(page.locator('#preset')).toContainText('Ion trap CID · tryptic')
  await expect(summary).not.toHaveText(before ?? '')
  await expect(summary).toContainText('Da fragment')
})

test('the database card: the organisms to download, and the NCBI search for another', async ({ page }) => {
  const card = page.getByTestId('proteome-download')
  await expect(card).toContainText('Human (Homo sapiens) · UP000005640')
  await card.locator('#organism').click()
  const list = page.getByRole('listbox')
  for (const name of ['Human (Homo sapiens)', 'Mouse (Mus musculus)', 'Yeast (Saccharomyces cerevisiae S288C)', 'E. coli K-12'])
    await expect(list.getByRole('option', { name: new RegExp(`^${name.replace(/[().]/g, '\\$&')} · UP`) })).toBeVisible()
  await list.getByRole('option', { name: /^Other organism/ }).click()
  const box = page.getByRole('textbox', { name: /Organism name \(NCBI Taxonomy\)/ })
  await expect(box).toBeVisible()
  const search = card.getByRole('button', { name: 'Search', exact: true })
  await expect(search).toBeDisabled()
  await box.fill('Chlamydomonas')
  await expect(search).toBeEnabled()
  await expect(card.getByRole('button', { name: 'Download' })).toBeDisabled()
})
