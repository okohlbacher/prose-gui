// The tests' ways around the Results screen that the oracle and metamorphic tests share.
import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'

/** The number of a count as the app writes it ("1,790", "55 %", "+4.1"). */
export const parseCount = (text: string) => Number(text.replace(/[,\s%+]/g, '').replace('−', '-'))

/** Opens a tab of Results by its name. */
export async function openTab(page: Page, name: 'Overview' | 'Proteins' | 'Peptides' | 'PSMs' | 'Samples' | 'QC'): Promise<void> {
  const tab = page.getByTestId('results-tabs').getByRole('tab', { name: new RegExp(`^${name}`) })
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
}

/** The tab's "shown of total" count. */
export async function rowCount(page: Page): Promise<{ shown: number; total: number }> {
  const text = (await page.getByTestId('filter-bar').getByTestId('row-count').innerText()).split('·')[0]
  const [shown, total] = text.split(' of ').map(parseCount)
  return { shown, total }
}

/** Exports the current view (`kind` CSV or Excel) through the Export menu: the downloaded bytes and the file name. */
export async function exportView(page: Page, kind: 'CSV' | 'Excel'): Promise<{ name: string; bytes: Buffer }> {
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const item = page.getByRole('menuitem', { name: kind === 'CSV' ? 'CSV (current view)' : 'Excel .xlsx (current view)' })
  const [download] = await Promise.all([page.waitForEvent('download'), item.click()])
  return { name: download.suggestedFilename(), bytes: readFileSync(await download.path()) }
}

/** Types `text` into the tab's text filter and waits for the count to change. */
export async function filterText(page: Page, text: string): Promise<void> {
  const box = page.getByTestId('filter-bar').getByRole('searchbox')
  const before = await rowCount(page)
  await box.fill(text)
  // (the filter applies 150 ms after the typing): until the count has changed, or for at most a second
  await expect
    .poll(async () => JSON.stringify(await rowCount(page)) !== JSON.stringify(before), { timeout: 1000 })
    .toBe(true)
    .catch(() => {})
}

/** Opens the PSM view of the first PSM of `sequence` (PSMs tab, its text filter): the view. */
export async function openPsm(page: Page, sequence: string, charge?: number) {
  await openTab(page, 'PSMs')
  await filterText(page, sequence)
  const rows = page.getByTestId('results-table').locator('tbody tr')
  const row = charge === undefined ? rows.first() : rows.filter({ has: page.locator('td', { hasText: new RegExp(`^${charge}$`) }) }).first()
  await row.click()
  const view = page.getByTestId('psm-view')
  await expect(view.getByTestId('ion-table')).toBeVisible()
  await expect(view.getByTestId('spectrum')).toBeVisible()
  return view
}

/** The numbers of the key figures above the tabs, and the notes and tooltips under them. */
export async function keyFigureTiles(page: Page) {
  const tile = async (id: string) => {
    const value = page.getByTestId(id)
    const box = value.locator('xpath=..')
    return { value: (await value.innerText()).trim(), note: (await box.innerText()).split('\n').slice(1).join(' ').trim(), title: (await box.getAttribute('title')) ?? '' }
  }
  return {
    proteins: await tile('protein-count'),
    peptides: await tile('peptide-count'),
    psms: await tile('psm-count'),
    error: await tile('precursor-error'),
  }
}
