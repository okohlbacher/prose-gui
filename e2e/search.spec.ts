// The example searched through the app's screens: New search with the example, Start, Results.
// Gated: runs only with PROSE_BIN set (the app inherits it). The search's folder (in the app's data
// folder) is removed at the end.
import { rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const enabled = Boolean(process.env.PROSE_BIN)
const searches = join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local/share'), 'org.openms.prose.desktop', 'searches')

describe('the example search', () => {
  let searchId: string | null = null

  before(function () {
    if (!enabled) {
      console.log('skipped: set PROSE_BIN to run the example search through the app')
      this.skip()
    }
  })

  after(() => {
    if (searchId) rmSync(join(searches, searchId), { recursive: true, force: true })
  })

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
    searchId = /#\/results\/([^/]+)$/.exec(await browser.getUrl())![1]
    const count = $('[data-testid="psm-count"]')
    await count.waitForDisplayed({ timeout: 20000 })
    await expect(count).toHaveText(expect.stringContaining('1,790'))
    expect(await $('[data-testid="result-chip"]').getProperty('textContent')).toContain('DatabaseSuitability · 2 files')
  })
})
