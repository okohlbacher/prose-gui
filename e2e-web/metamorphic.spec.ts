// Metamorphic tests: relations between two runs of the same screen that must hold whatever the right numbers are.
// A tighter cutoff or one more filter never shows more rows; filters commute; exporting a filtered view equals
// filtering the exported view; Re-run brings back the settings of the search; the theme changes no number.
import type { Page } from '@playwright/test'
import { expect, openFixture, test } from './fixtures'
import { parseCsv } from './oracle/files'
import { loadFixture, passesQ, FIXTURE_PSM_FDR } from './oracle/qpx'
import { exportView, filterText, openPsm, openTab, rowCount } from './oracle/screen'

/** Sets the level's q-value cutoff (its popover in the filter bar) to `percent` %. */
async function setCutoff(page: Page, percent: number): Promise<void> {
  const bar = page.getByTestId('filter-bar')
  await bar.getByRole('button', { name: /(PSM FDR|Best PSM q-value|Protein FDR) ≤/ }).click()
  const input = page.locator('[data-slot="popover-content"] input')
  await input.fill(String(percent))
  await input.press('Tab')
  await page.keyboard.press('Escape')
  await expect(bar.getByRole('button', { name: /≤/ })).toContainText(`≤ ${percent} %`)
}

const csvRows = async (page: Page) => {
  const [header, ...body] = parseCsv((await exportView(page, 'CSV')).bytes.toString('utf8')).filter((r) => r.join('') !== '')
  return { header, body }
}

test('a tighter q-value cutoff never shows more PSMs or peptides, and shows the oracle count', async ({ page }) => {
  const f = await loadFixture('suitability')
  await openFixture(page, 'suitability')
  for (const tab of ['PSMs', 'Peptides'] as const) {
    await openTab(page, tab)
    let last = Infinity
    for (const percent of [2, 0.5, 0.2, 0.15, 0.1, 0.05]) {
      await setCutoff(page, percent)
      const { shown } = await rowCount(page)
      expect(shown, `${tab} at ${percent} %`).toBeLessThanOrEqual(last)
      const targets = f.psms.filter((p) => !p.decoy && passesQ(p.q, percent / 100))
      expect(shown, `${tab} at ${percent} %: the oracle`).toBe(tab === 'PSMs' ? targets.length : new Set(targets.map((p) => p.peptidoform)).size)
      last = shown
    }
  }
})

test('each added PSM filter keeps a subset of the rows', async ({ page }) => {
  await openFixture(page)
  await openTab(page, 'PSMs')
  const bar = page.getByTestId('filter-bar')
  const counts = [(await rowCount(page)).shown]
  const keys = async () => (await csvRows(page)).body.map((r) => r[3]) // the spectrum: unique per PSM here
  let previous = new Set(await keys())
  const steps: [string, () => Promise<void>][] = [
    ['charge 2+', () => bar.getByRole('group', { name: 'Precursor charges' }).getByRole('button', { name: '2+' }).click()],
    ['text K', () => filterText(page, 'K')],
    ['m/z from 450', async () => {
      await bar.getByRole('button', { name: '+ Filter' }).click()
      await page.getByRole('menuitem', { name: 'Precursor m/z' }).click()
      await bar.getByTestId('range-chip').click()
      const from = page.getByLabel('From')
      await from.fill('450')
      await from.dispatchEvent('change')
      await page.keyboard.press('Escape')
    }],
    ['PSM FDR 1.5 %', () => setCutoff(page, 1.5)],
  ]
  for (const [name, step] of steps) {
    await step()
    const { shown } = await rowCount(page)
    expect(shown, name).toBeLessThanOrEqual(counts.at(-1)!)
    counts.push(shown)
    const now = new Set(await keys())
    for (const k of now) expect(previous.has(k), `${name}: ${k} was not shown before`).toBe(true)
    previous = now
  }
  expect(counts[1]).toBeGreaterThan(0)
})

test('filters commute: charge then text equals text then charge, as rows and as CSV', async ({ page }) => {
  await openFixture(page)
  await openTab(page, 'PSMs')
  const charge = page.getByTestId('filter-bar').getByRole('group', { name: 'Precursor charges' }).getByRole('button', { name: '2+' })
  await charge.click()
  await filterText(page, 'VIMSS14264')
  const a = await csvRows(page)
  // undo both, then the other order
  await charge.click()
  await filterText(page, '')
  expect(await rowCount(page)).toEqual({ shown: 154, total: 154 })
  await filterText(page, 'VIMSS14264')
  await charge.click()
  const b = await csvRows(page)
  expect(b.body.length).toBeGreaterThan(0)
  expect(b).toEqual(a)
})

test('filtering then exporting equals exporting then filtering', async ({ page }) => {
  await openFixture(page)
  await openTab(page, 'PSMs')
  const all = await csvRows(page)
  const z = all.header.indexOf('Charge')
  const q = all.header.indexOf('q-value')
  const proteins = all.header.indexOf('Proteins')
  await page.getByTestId('filter-bar').getByRole('group', { name: 'Precursor charges' }).getByRole('button', { name: '3+' }).click()
  await filterText(page, 'VIMSS14264')
  const filtered = await csvRows(page)
  const expected = all.body.filter((r) => r[z] === '3' && Number(r[q]) <= FIXTURE_PSM_FDR && r[proteins].includes('VIMSS14264'))
  expect(filtered.header).toEqual(all.header)
  expect(filtered.body).toEqual(expected)
  expect(expected.length).toBeGreaterThan(0)
})

test('Re-run brings back the settings the search was made with, changed only where it says', async ({ page }) => {
  const f = await loadFixture('example')
  await openFixture(page)
  await openTab(page, 'Overview')
  await page.getByRole('button', { name: 'Re-run with ±50 ppm' }).first().click()
  await expect(page.locator('#precursor-tolerance')).toBeVisible()
  const value = (id: string) => page.locator(`#${id}`).inputValue()
  expect(await value('precursor-tolerance'), 'the change').toBe('50')
  expect(await value('fragment-tolerance')).toBe(f.search.get('fragment_mass_tolerance'))
  expect(await value('missed-cleavages')).toBe(f.search.get('missed_cleavages'))
  expect(await page.getByLabel('Lowest precursor charge').inputValue()).toBe(f.search.get('min_charge'))
  expect(await page.getByLabel('Highest precursor charge').inputValue()).toBe(f.search.get('max_charge'))
  expect(await page.getByLabel('Shortest peptide (residues)').inputValue()).toBe(f.search.get('peptide_min_length'))
  expect(await page.getByLabel('Longest peptide (residues)').inputValue()).toBe(f.search.get('peptide_max_length'))
  await expect(page.locator('#enzyme')).toHaveText(f.search.get('enzyme')!)
  expect(await value('psm-fdr'), 'the PSM FDR of the search (%)').toBe(String(FIXTURE_PSM_FDR * 100))
  for (const mod of f.search.get('variable_modifications')!.split(',')) await expect(page.locator('main')).toContainText(mod.trim())
  await expect(page.locator('#percolator')).toHaveAttribute('aria-checked', String(f.runs.some((r) => r.rescored)))
})

/** Every number on the main screens of the example, in order: the key figures, each tab, QC's tables, a PSM's view. */
async function numbersOnScreens(page: Page): Promise<Record<string, string[]>> {
  const numbers = async () => (await page.locator('main').innerText()).match(/[−+-]?\d[\d,]*(\.\d+)?/g) ?? []
  const out: Record<string, string[]> = {}
  await page.goto('about:blank')
  await openFixture(page)
  for (const tab of ['Overview', 'Proteins', 'Peptides', 'PSMs', 'Samples'] as const) {
    await openTab(page, tab)
    out[tab] = await numbers()
  }
  await openTab(page, 'QC')
  for (const summary of await page.getByTestId('qc-content').getByText('Table', { exact: true }).all()) await summary.click()
  out.QC = await numbers()
  await openPsm(page, 'RFYDAVSTFK')
  out.PSM = (await page.getByTestId('psm-view').innerText()).match(/[−+-]?\d[\d,]*(\.\d+)?/g) ?? []
  return out
}

test('the theme changes no number: light and dark show the same', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  const light = await numbersOnScreens(page)
  await page.emulateMedia({ colorScheme: 'dark' })
  const dark = await numbersOnScreens(page)
  await expect(page.locator('html')).toHaveClass(/\bdark\b/)
  expect(Object.values(light).flat().length).toBeGreaterThan(300)
  expect(dark).toEqual(light)
})
