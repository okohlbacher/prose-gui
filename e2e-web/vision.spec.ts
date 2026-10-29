// Vision checks (npm run test:ui:vision, only with VISION_API_KEY; e2e-web/vision/client.ts): one structured question
// per screen about its screenshot, answered by a vision model as JSON of a fixed schema and compared with the oracle
// (e2e-web/oracle/). They check what only the picture shows: that the labels drawn are the matched ions, the series'
// colours, the axis titles, clipped or overlapping text, the contrast of the dark theme. Answers are cached by the
// screenshot's hash in e2e-web/.vision-cache (gitignored): unchanged screens ask nothing again.
import { expect, openFixture, test } from './fixtures'
import { byIons, matchIons, MODIFICATION } from './oracle/fragments'
import { coverage, keyFigures, loadFixture, peaksOf, targetPsms } from './oracle/qpx'
import { openPsm, openTab } from './oracle/screen'
import { ask, visionConfig } from './vision/client'
import { DARK_SPECTRUM, KEY_FIGURES, PROTEIN_PANEL, SPECTRUM, type ContrastAnswer, type FiguresAnswer, type PanelAnswer, type SpectrumAnswer } from './vision/questions'

const cfg = visionConfig()
test.skip(!cfg, 'set VISION_API_KEY (and VISION_PROVIDER, VISION_MODEL) to run the vision checks')
test.describe.configure({ mode: 'serial' })
test.use({ reducedMotion: 'reduce' })
test.setTimeout(180_000)

const SEQUENCE = 'RFYDAVSTFK'

/** The ions of the example's PSM of SEQUENCE that a stored peak matches (the oracle). */
async function matchedIons(): Promise<string[]> {
  const f = await loadFixture('example')
  const psm = targetPsms(f).find((p) => p.sequence === SEQUENCE)!
  const mods = new Map<number, number>()
  for (const m of psm.mods) for (const pos of m.positions) mods.set(pos, MODIFICATION[m.accession])
  const peaks = (await peaksOf(f, psm))!
  return [...matchIons(byIons(psm.sequence, mods), peaks.mz, Number(f.search.get('fragment_mass_tolerance'))).keys()]
}

const shot = async (locator: import('@playwright/test').Locator) => locator.screenshot({ animations: 'disabled', caret: 'hide' })

test('spectrum: the labels drawn are the matched ions, b blue and y orange, the axes titled, no text clipped', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await openFixture(page)
  const view = await openPsm(page, SEQUENCE)
  const { answer } = await ask<SpectrumAnswer>(cfg!, SPECTRUM, await shot(view.getByTestId('spectrum')))
  const matched = await matchedIons()
  const seen = answer.peak_labels.map((l) => l.trim()).filter((l) => /^[by]\d+$/.test(l))
  // every label it reads is a matched ion (one misreading allowed), and it reads most of them (labels can crowd)
  expect(seen.filter((l) => !matched.includes(l)).length, `labels read: ${seen.join(' ')}`).toBeLessThanOrEqual(1)
  expect(new Set(seen.filter((l) => matched.includes(l))).size).toBeGreaterThanOrEqual(Math.ceil(0.7 * matched.length))
  expect(answer.b_ion_colour).toBe('blue')
  expect(answer.y_ion_colour).toBe('orange')
  expect(answer.x_axis_label?.replace(/\s/g, '').toLowerCase()).toBe('m/z')
  // relative intensity: a y-axis title saying so, or percent ticks (the app labels the scale with 50 % and 100 %)
  expect(/intensity/i.test(answer.y_axis_label ?? '') || answer.y_axis_tick_labels.some((t) => t.includes('%')), JSON.stringify(answer)).toBe(true)
  expect(answer.text_clipped_or_overlapping, answer.clipped_or_overlapping_items.join('; ')).toBe(false)
})

test('spectrum in the dark theme: readable contrast, the same series colours', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await openFixture(page)
  const view = await openPsm(page, SEQUENCE)
  await expect(page.locator('html')).toHaveClass(/\bdark\b/)
  const { answer } = await ask<ContrastAnswer>(cfg!, DARK_SPECTRUM, await shot(view.getByTestId('spectrum')))
  expect(answer.readable_contrast, answer.low_contrast_items.join('; ')).toBe(true)
  expect(answer.peak_labels_legible).toBe(true)
  expect([answer.b_ion_colour, answer.y_ion_colour]).toEqual(['blue', 'orange'])
})

test('protein panel: the header states the coverage % and counts of the oracle, with the coverage map', async ({ page }) => {
  const f = await loadFixture('example')
  const accession = 'VIMSS14264'
  const c = coverage(f, accession)
  await openFixture(page)
  await openTab(page, 'Proteins')
  await page.getByTestId('filter-bar').getByRole('searchbox').fill(accession)
  await page.getByTestId('results-table').locator('tbody tr', { hasText: accession }).first().click()
  const panel = page.getByTestId('protein-panel')
  await panel.getByRole('tab', { name: /^Coverage/ }).click()
  await expect(panel.getByTestId('coverage-map')).toBeVisible()
  const { answer } = await ask<PanelAnswer>(cfg!, PROTEIN_PANEL, await shot(panel))
  expect(answer.accession).toContain(accession)
  expect(answer.coverage_percent_in_header, 'coverage % in the header').not.toBeNull()
  expect(Math.abs(answer.coverage_percent_in_header! - (c.covered / c.length) * 100)).toBeLessThanOrEqual(0.051)
  expect(answer.peptides_in_header).toBe(c.peptides.size)
  expect(answer.psms_in_header).toBe(targetPsms(f).filter((p) => p.proteins.some((m) => m.accession === accession)).length)
  expect(answer.coverage_map_visible).toBe(true)
  expect(answer.text_clipped_or_overlapping, answer.clipped_or_overlapping_items.join('; ')).toBe(false)
})

test('key figures: the numbers as painted are the oracle numbers', async ({ page }) => {
  const k = keyFigures(await loadFixture('example'))
  await page.emulateMedia({ colorScheme: 'light' })
  await openFixture(page)
  const strip = page.getByTestId('psm-count').locator('xpath=ancestor::div[contains(@class, "grid-cols-5")]')
  const { answer } = await ask<FiguresAnswer>(cfg!, KEY_FIGURES, await shot(strip))
  expect(answer.protein_groups).toBe(k.proteinGroups)
  expect(answer.peptides).toBe(k.peptides.size)
  expect(answer.psms).toBe(k.psms.length)
  expect(answer.percent_of_ms2).toBe(Math.round((k.spectra / k.ms2) * 100))
  expect(answer.median_precursor_error_ppm).toBeCloseTo(k.medianAbsPpm!, 1)
  expect(answer.psm_fdr_percent_stated).toBe(2)
  expect(answer.text_clipped_or_overlapping, answer.clipped_or_overlapping_items.join('; ')).toBe(false)
})
