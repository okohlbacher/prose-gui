// The example searched through the app's screens: New search with the example, Start, Results.
// Gated: runs only with PROSE_BIN set (the app inherits it). Every test that needs a result searches the
// example itself, so each runs alone; the searches' folders (in the spec's own data folder) are removed
// after each test.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { clearSearches, openFirstPsm, runExample, searchesDir } from './lib.ts'

const enabled = Boolean(process.env.PROSE_BIN)

describe('the example search', () => {
  before(function () {
    if (!enabled) {
      console.log('skipped: set PROSE_BIN to run the example search through the app')
      this.skip()
    }
  })

  afterEach(() => clearSearches())

  it('the CSP lets the results reader start its WebAssembly zstd decoder (from a data: URL)', async () => {
    await $('header').waitForDisplayed({ timeout: 20000 })
    // the smallest module, loaded as zstddec loads its own
    const outcome = await browser.execute(() =>
      fetch('data:application/wasm;base64,AGFzbQEAAAA=')
        .then((r) => r.arrayBuffer())
        .then((b) => WebAssembly.instantiate(b))
        .then(
          () => 'ok',
          (e) => String(e),
        ),
    )
    expect(outcome).toBe('ok')
  })

  it('the monospace fonts are the bundled ones (Liberation Mono, Inconsolata), not a wider system one', async () => {
    await $('header').waitForDisplayed({ timeout: 20000 })
    // In the web app's headless Chromium, 'NDSVIVADQTPTPTR' at 12.5px is 93.75 px in the peptide stack
    // (a 0.5 em font there) and 112.53 px in font-mono (Liberation Mono, 0.6 em). The app bundles
    // Inconsolata (0.5 em) for sequences and Liberation Mono. WebKitGTK sets text at whole pixel sizes
    // (12.5px as 13px) and Inconsolata's and Liberation Mono's hinted advances fall on whole pixels, so here
    // they measure 90 and 120 px; the system's DejaVu Sans Mono 120.
    const widths = await browser.execute(async () => {
      await document.fonts.load('12.5px "Inconsolata"')
      await document.fonts.load('12.5px "Liberation Mono"')
      const width = (font: string, className = '') => {
        const s = document.createElement('span')
        s.className = className
        if (font) s.style.font = font
        s.style.fontSize = '12.5px'
        s.textContent = 'NDSVIVADQTPTPTR'
        document.body.append(s)
        const w = s.getBoundingClientRect().width
        s.remove()
        return w
      }
      return {
        // as the components use them: the peptide stack, and Tailwind's font-mono class
        sequence: width('12.5px var(--font-sequence)'),
        mono: width('', 'font-mono'),
        inconsolata: width('12.5px "Inconsolata"'),
        liberation: width('12.5px "Liberation Mono"'),
        dejavu: width('12.5px "DejaVu Sans Mono"'),
      }
    })
    console.log('monospace widths', JSON.stringify(widths))
    expect(widths.sequence).toBe(widths.inconsolata)
    expect(widths.mono).toBe(widths.liberation)
    // 0.5 em and 0.6 em per character (at 12.5 or 13 px; hinted advances rounded to whole pixels)
    expect(widths.sequence / 15).toBeGreaterThanOrEqual(6)
    expect(widths.sequence / 15).toBeLessThanOrEqual(6.5)
    expect(widths.mono / 15).toBeGreaterThanOrEqual(7.5)
    expect(widths.mono / 15).toBeLessThanOrEqual(8)
    expect(widths.sequence).toBeLessThan(widths.dejavu - 10)
  })

  it('the example search shows 1,790 PSMs', async () => {
    await $('header').waitForDisplayed({ timeout: 20000 })
    await $('button=Try the example').click()
    // the two files in the design table, the database counted
    await expect($('[data-testid="design-summary"]')).toHaveText('2 files → 2 samples · 1 condition')
    await expect($('[data-testid="fasta-proteins"]')).toHaveText('49 proteins')
    // (textContent: the footer line is cut to the window's width)
    expect(await $('[data-testid="search-plan"]').getProperty('textContent')).toBe(
      '2 files in 2 samples · 49 proteins + 116 cRAP + decoys · example: 5 % protein FDR, small database',
    )
    await $('button*=Start search').click()
    await expect($('[data-testid="search-progress"]')).toBeDisplayed()
    await browser.waitUntil(async () => /#\/results\/[^/]+$/.test(await browser.getUrl()), {
      timeout: 180000,
      interval: 500,
      timeoutMsg: 'the search did not open its result',
    })
    const count = $('[data-testid="psm-count"]')
    await count.waitForDisplayed({ timeout: 20000 })
    await expect(count).toHaveText(expect.stringContaining('1,790'))
    expect(await $('[data-testid="result-chip"]').getProperty('textContent')).toContain('DatabaseSuitability · 2 files')
  })

  it('the example without PeptDeep still shows the prediction', async () => {
    // PeptDeep is off for the search (no rescoring features), yet ProSE writes the prediction of every PSM
    await runExample()
    await openFirstPsm()
    await expect($('[data-testid="bottom-label"]')).toHaveText(expect.stringContaining('PeptDeep'))
    expect((await $$('[data-testid="bottom-peaks"]')).length).toBeGreaterThan(0)
    expect(await $$('[data-testid="bottom-status"]')).toHaveLength(0)
    expect(await $('input[type="radio"][value="peptdeep"]').isSelected()).toBe(true)
    expect(await $('input[type="radio"][value="peptdeep"]').isEnabled()).toBe(true)
  })

  it('History survives a restart: the search is listed, can be renamed, and opens again with its results', async () => {
    const searchId = await runExample()
    const row = () => $(`[data-testid="history-row"][data-id="${searchId}"]`)
    await $('nav[aria-label="Main"]').$('a=History').click()
    await row().waitForDisplayed({ timeout: 20000 })
    // (textContent: WebKit's visible text leaves out the cells that the table cuts to its width)
    expect(await row().getProperty('textContent')).toContain('DatabaseSuitability_1.mzML, DatabaseSuitability_2.mzML')
    // the folder has its record: the shim's outputs, proteins.fasta and search.json
    expect(existsSync(join(searchesDir(), searchId, 'search.json'))).toBe(true)
    expect(existsSync(join(searchesDir(), searchId, 'proteins.fasta'))).toBe(true)

    await row().$('button=Rename').click()
    await row().$('input').waitForDisplayed()
    // (typed into the field, which has the focus and the name selected; WebDriver's clear would blur it and end the
    // rename; a name with a space came out garbled through WebKitWebDriver)
    await browser.keys([...'Renamed_search', 'Enter'])
    await browser.waitUntil(async () => String(await row().getProperty('textContent')).includes('Renamed_search'))

    // the app starts again (a new process): History lists the search, and it opens with its results
    await browser.reloadSession()
    await $('header').waitForDisplayed({ timeout: 30000 })
    await $('nav[aria-label="Main"]').$('a=History').click()
    await row().waitForDisplayed({ timeout: 20000 })
    expect(await row().getProperty('textContent')).toContain('Renamed_search')
    await row().$('button=Open').click()
    await browser.waitUntil(async () => (await browser.getUrl()).endsWith(`#/results/${searchId}`), { timeout: 30000 })
    const count = $('[data-testid="psm-count"]')
    await count.waitForDisplayed({ timeout: 30000 })
    await expect(count).toHaveText(expect.stringContaining('1,790'))
  })
})
