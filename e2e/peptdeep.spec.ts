// The example searched with PeptDeep, and what the app does with its result: the PSM view with PeptDeep's
// mirror, the ion toggles, and a project file that opens again with the same PSMs.
// Gated: runs only with PROSE_BIN set (the app inherits it).
import { readFileSync } from 'node:fs'
import { appReady, clearSearches, dataHome, goTo, jsClick, searchFolders, waitForResults } from './lib.ts'
import { join } from 'node:path'

const enabled = Boolean(process.env.PROSE_BIN)

/** The labels of the matched peaks in the spectrum. */
const peakLabels = (): Promise<string[]> =>
  browser.execute(() => [...document.querySelectorAll('[data-testid="peak-label"]')].map((l) => l.textContent ?? ''))

/** Opens the PSM view of the first PSM in the PSMs tab. */
async function openFirstPsm() {
  await jsClick(await $('[role="tablist"]').$('button*=PSMs'))
  const grid = $('[role="grid"][aria-label="PSMs"]')
  await grid.waitForDisplayed({ timeout: 10000 })
  await browser.waitUntil(async () => (await grid.$$('tbody tr[aria-rowindex]')).length > 0)
  await jsClick((await grid.$$('tbody tr[aria-rowindex]'))[0])
  await $('[data-testid="psm-view"]').waitForDisplayed({ timeout: 10000 })
}

describe('the example with PeptDeep', () => {
  before(async function () {
    if (!enabled) {
      console.log('skipped: set PROSE_BIN to run the example through the app')
      this.skip()
    }
    await appReady()
  })

  after(() => clearSearches())

  it('the example with PeptDeep: 1,790 PSMs, a PSM shows the PeptDeep mirror', async () => {
    await $('button=Try the example').click()
    await expect($('[data-testid="fasta-proteins"]')).toHaveText('49 proteins')
    await $('#peptdeep').click()
    await expect($('#peptdeep')).toHaveAttribute('aria-checked', 'true')
    await $('button*=Start search').click()
    await waitForResults()
    const count = $('[data-testid="psm-count"]')
    await count.waitForDisplayed({ timeout: 20000 })
    await expect(count).toHaveText(expect.stringContaining('1,790'))

    await openFirstPsm()
    // the lower half is PeptDeep's prediction, with peaks, not the theoretical spectrum or a "no prediction" note
    await expect($('[data-testid="bottom-label"]')).toHaveText(expect.stringContaining('PeptDeep'))
    expect((await $$('[data-testid="bottom-peaks"]')).length).toBeGreaterThan(0)
    expect(await $$('[data-testid="bottom-status"]')).toHaveLength(0)
    await expect($('[data-testid="similarity"]')).toBeExisting()
    // the radio of the bottom half is on the prediction
    expect(await $('input[type="radio"][value="peptdeep"]').isSelected()).toBe(true)
  })

  it('ion toggles change the annotation', async () => {
    const before = await peakLabels()
    expect(before.length).toBeGreaterThan(0)
    expect(before.some((l) => l.startsWith('y'))).toBe(true)
    // the matched peaks' paths, one per series (b, y, ...)
    const matched = (): Promise<string[]> =>
      browser.execute(() => [...document.querySelectorAll('[data-testid="matched-peaks"]')].map((p) => p.getAttribute('d') ?? ''))
    const dBefore = await matched()

    // y ions off: no label of a y ion is left, and the matched peaks are fewer
    await jsClick(await $('input[aria-label="y ions"]'))
    await browser.waitUntil(async () => !(await peakLabels()).some((l) => l.startsWith('y')), { timeoutMsg: 'y labels are still there' })
    expect((await matched()).length).toBeLessThan(dBefore.length)
    expect((await peakLabels()).some((l) => l.startsWith('b'))).toBe(true)

    // back on: the annotation is as it was
    await jsClick(await $('input[aria-label="y ions"]'))
    await browser.waitUntil(async () => (await peakLabels()).some((l) => l.startsWith('y')))
    expect(await matched()).toEqual(dBefore)
    expect(await peakLabels()).toEqual(before)
  })

  it('a project opens again with the same PSMs', async () => {
    // Export > Project (.prose): the app writes it where the specs' dialog seam says (app.sh)
    await browser.keys('Escape')
    await $('[data-testid="psm-count"]').waitForDisplayed()
    await $('header').$('button*=Export').click()
    await $('[role="menuitem"]*=Project (.prose)').click()
    const file = join(dataHome(), 'chosen.prose')
    await browser.waitUntil(() => {
      try {
        return readFileSync(file).length > 0
      } catch {
        return false
      }
    }, { timeoutMsg: 'no project file was written' })
    // a zip
    expect(readFileSync(file).subarray(0, 2).toString('latin1')).toBe('PK')

    // History is cleared of the search, then the project is opened: it comes back as a search of its own
    await goTo('History')
    const rows = $$('[data-testid="history-row"]')
    await browser.waitUntil(async () => (await rows.length) === 1)
    await $('button[aria-label^="Delete"]').click()
    await $('[role="dialog"]').$('button=Delete').click()
    await $('[data-testid="history-empty"]').waitForDisplayed()
    expect(searchFolders().finished).toEqual([])

    await $('[data-testid="open-project"]').click()
    await waitForResults(30000)
    const count = $('[data-testid="psm-count"]')
    await count.waitForDisplayed({ timeout: 30000 })
    await expect(count).toHaveText(expect.stringContaining('1,790'))
    // the PSM view opens as before: the spectrum and the prediction are in the project
    await openFirstPsm()
    await expect($('[data-testid="bottom-label"]')).toHaveText(expect.stringContaining('PeptDeep'))
    expect((await $$('[data-testid="bottom-peaks"]')).length).toBeGreaterThan(0)
  })
})
