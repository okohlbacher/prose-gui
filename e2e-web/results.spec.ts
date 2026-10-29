// Results of the bundled example (src/lib/results/fixtures/example, opened through the dev hook `?fixture=`).
import { MOD, expect, openFixture, test } from './fixtures'

test.beforeEach(async ({ page }) => {
  await openFixture(page)
})

test('the key figures say which FDR controls each count', async ({ page }) => {
  const header = page.locator('main')
  await expect(header.getByText('protein groups · 61 proteins · no protein FDR')).toBeVisible()
  await expect(header.getByText('peptides · at 2 % PSM FDR · no peptide FDR')).toBeVisible()
  await expect(header.getByText(/^PSMs · at 2 % PSM FDR · \d+ % of MS2$/)).toBeVisible()
  await expect(header.getByText('median |precursor error|')).toBeVisible()
})

test('the tabs: Overview, Proteins, Peptides, PSMs, Samples, QC (by click and by ⌘/Ctrl 1–6)', async ({ page }) => {
  const tabs = page.getByTestId('results-tabs').getByRole('tab')
  await expect(tabs).toHaveText([/^Overview/, /^Proteins\s*61/, /^Peptides\s*64/, /^PSMs\s*154/, /^Samples/, /^QC/])
  const content: [string, string][] = [
    ['Overview', 'search-facts'],
    ['Proteins', 'results-table'],
    ['Peptides', 'results-table'],
    ['PSMs', 'results-table'],
    ['Samples', 'sample-row'],
    ['QC', 'qc-content'],
  ]
  for (const [name, testid] of content) {
    const tab = tabs.filter({ hasText: name }).first()
    await tab.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId(testid).first()).toBeVisible()
  }
  for (let i = 1; i <= 6; i++) {
    await page.keyboard.press(`${MOD}+Digit${i}`)
    await expect(tabs.nth(i - 1)).toHaveAttribute('aria-selected', 'true')
  }
})

test('a protein opens its panel with the coverage', async ({ page }) => {
  await page.getByRole('tab', { name: /^Proteins/ }).click()
  await page.getByTestId('results-table').locator('tbody tr').first().click()
  const panel = page.getByTestId('protein-panel')
  await expect(panel).toBeVisible()
  await expect(panel.getByTestId('panel-accession')).toContainText('VIMSS')
  await expect(panel.getByTestId('panel-coverage')).toHaveText(/^Coverage \d+(\.\d) %$/)
  await expect(panel.getByTestId('coverage-map').or(panel.getByTestId('coverage-strip')).first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
})

test('a PSM opens the spectrum view', async ({ page }) => {
  await page.getByRole('tab', { name: /^PSMs/ }).click()
  const first = page.getByTestId('results-table').locator('tbody tr').first()
  const peptide = (await first.locator('td').first().innerText()).trim()
  await first.click()
  const view = page.getByTestId('psm-view')
  await expect(view).toBeVisible()
  await expect(view.getByTestId('spectrum')).toBeVisible()
  await expect(view.getByTestId('fragment-ladder')).toBeVisible()
  await expect(view.getByTestId('psm-header')).toBeVisible()
  await expect(view).toContainText(peptide)
  await page.keyboard.press('Escape')
  await expect(view).toBeHidden()
})

test('the PSM charge and range filters, with the targets and decoys they keep', async ({ page }) => {
  await page.getByRole('tab', { name: /^PSMs/ }).click()
  const bar = page.getByTestId('filter-bar')
  const count = bar.getByTestId('row-count')
  await expect(count).toHaveText('154 of 154')
  await expect(bar.getByTestId('subset-fdr')).toBeHidden()

  // the charge: 2+ only
  const charges = bar.getByRole('group', { name: 'Precursor charges' })
  await charges.getByRole('button', { name: '2+' }).click()
  await expect(charges.getByRole('button', { name: '2+' })).toHaveAttribute('aria-pressed', 'true')
  await expect(count).not.toHaveText(/^154 of 154/)
  const twoPlus = Number((await count.textContent())!.split(' of ')[0])
  expect(twoPlus).toBeGreaterThan(0)
  expect(twoPlus).toBeLessThan(154)
  await expect(bar.getByTestId('subset-fdr')).toHaveText(/targets \d+ · decoys \d+ · est\. FDR ≈ [\d.]+ % \(within the passing set\)/)
  await charges.getByRole('button', { name: '2+' }).click()
  await expect(count).toHaveText('154 of 154')

  // a range: the score, narrowed from its lower end
  await bar.getByRole('button', { name: '+ Filter' }).click()
  await page.getByRole('menuitem', { name: 'Score' }).click()
  const chip = bar.getByTestId('range-chip')
  await expect(chip).toHaveText(/^Score: [-\d.]+ – [-\d.]+$/)
  await chip.click()
  const from = page.getByLabel('From')
  const lowest = Number(await from.inputValue())
  const highest = Number(await page.getByLabel('To').inputValue())
  await from.fill(String((lowest + highest) / 2))
  await from.press('Enter')
  await from.dispatchEvent('change')
  await page.keyboard.press('Escape')
  await expect(count).not.toHaveText(/^154 of 154/)
  await expect(bar.getByTestId('subset-fdr')).toBeVisible()
})

test('Export has CSV and Excel of the current view', async ({ page }) => {
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitem', { name: 'CSV (current view)' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Excel .xlsx (current view)' })).toBeVisible()
  await page.keyboard.press('Escape')
})
