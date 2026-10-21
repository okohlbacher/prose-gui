// Inputs by path, as the file manager would hand them over: names with spaces and umlauts, two inputs
// of the same name from different folders, and an mzML.gz. The example's run and FASTA are copied into
// folders made for the spec; the app reads them where they are.
// Gated: runs only with PROSE_BIN set (the app inherits it).
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { appReady, clearSearches, dropFiles, freshForm, goTo, searchFolders, textOf, waitForResults } from './lib.ts'

const enabled = Boolean(process.env.PROSE_BIN)
const example = resolve(fileURLToPath(new URL('../src-tauri/resources/example', import.meta.url)))
const MZML = join(example, 'DatabaseSuitability_in_spec.mzML')
const FASTA = join(example, 'DatabaseSuitability_database.fasta')

describe('inputs by path', () => {
  let work: string
  let umlautRun: string
  let umlautFasta: string

  before(async function () {
    if (!enabled) {
      console.log('skipped: set PROSE_BIN to run searches through the app')
      this.skip()
    }
    work = mkdtempSync(join(tmpdir(), 'prose-e2e-paths-'))
    const dir = join(work, 'Ünï cödé Ordner mit Leerzeichen', 'Läufe 2026')
    mkdirSync(dir, { recursive: true })
    umlautRun = join(dir, 'Probe Größe ä ö ü.mzML')
    umlautFasta = join(dir, 'Datenbank (Süß).fasta')
    copyFileSync(MZML, umlautRun)
    copyFileSync(FASTA, umlautFasta)
    await appReady()
  })

  after(() => {
    if (work) rmSync(work, { recursive: true, force: true })
    clearSearches()
  })

  /** Drops the paths on New search, starts the search and returns the text of the PSM count. */
  async function search(paths: string[], fileName: string) {
    await freshForm()
    await dropFiles(paths)
    // the table lists the file (one file has no design summary)
    await browser.waitUntil(async () => (await textOf('[data-testid="design-scroll"]')).includes(fileName), {
      timeoutMsg: `${fileName} is not in the table`,
    })
    await expect($('[data-testid="fasta-proteins"]')).toHaveText('49 proteins')
    await $('button*=Start search').click()
    await waitForResults()
    const count = $('[data-testid="psm-count"]')
    await count.waitForDisplayed({ timeout: 20000 })
    return textOf('[data-testid="psm-count"]')
  }

  let plainCount = ''

  it('paths with spaces and umlauts', async () => {
    plainCount = await search([umlautRun, umlautFasta], 'Probe Größe ä ö ü.mzML')
    expect(plainCount).toMatch(/\d/)
    // the file keeps its name (the result's own name is the common start of the file names, cut down to
    // letters, digits and "_.-" for file names: "Probe_Gr_e")
    await goTo('History')
    await $('[data-testid="history-row"]').waitForDisplayed()
    expect(await textOf('[data-testid="history-row"] [data-column="files"]')).toBe('Probe Größe ä ö ü.mzML')
    // nothing was written next to the inputs
    expect(readFileSync(umlautRun).length).toBe(readFileSync(MZML).length)
    expect(searchFolders().partial).toEqual([])
  })

  it('an mzML.gz searches like its mzML', async () => {
    const gz = join(work, 'Probe Größe ä ö ü.mzML.gz')
    writeFileSync(gz, gzipSync(readFileSync(MZML)))
    const count = await search([gz, umlautFasta], 'Probe Größe ä ö ü.mzML.gz')
    expect(count).toBe(plainCount)
  })

  it('two inputs of the same name are searched and kept apart', async () => {
    const first = join(work, 'erste Ablage')
    const second = join(work, 'zweite Ablage')
    mkdirSync(first)
    mkdirSync(second)
    copyFileSync(MZML, join(first, 'Lauf.mzML'))
    copyFileSync(MZML, join(second, 'Lauf.mzML'))
    await freshForm()
    await dropFiles([join(first, 'Lauf.mzML'), join(second, 'Lauf.mzML'), umlautFasta])
    await expect($('[data-testid="design-summary"]')).toHaveText(expect.stringContaining('2 files'))
    // the table tells them apart by their folders
    const folders = (
      await browser.execute(() => [...document.querySelectorAll('[data-testid="file-folder"]')].map((f) => f.textContent ?? ''))
    ).join(' ')
    expect(folders).toContain('erste Ablage')
    expect(folders).toContain('zweite Ablage')
    await $('button*=Start search').click()
    await waitForResults()
    const count = $('[data-testid="psm-count"]')
    await count.waitForDisplayed({ timeout: 20000 })
    // two copies of the run give what the example's two names give
    await expect(count).toHaveText(expect.stringContaining('1,790'))
    expect(await textOf('[data-testid="result-chip"]')).toContain('2 files')
  })
})
