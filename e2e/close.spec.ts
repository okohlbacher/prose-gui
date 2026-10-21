// The window closes during a search: the app ends, and no ProSE of its data folder outlives it.
// Gated: runs only with PROSE_BIN set (the app inherits it). These tests end the app, so they have a file
// of their own. Each test starts its own search and ends the app, so each runs alone.
import {
  appProcesses,
  appReady,
  clearSearches,
  closeWindowLikeAUser,
  freshForm,
  proseProcesses,
  searchFolders,
  textOf,
  windowCloseToolsMissing,
} from './lib.ts'

const enabled = Boolean(process.env.PROSE_BIN)

/** The example, started and in a file's step: ProSE runs. */
async function searchRunning() {
  await freshForm()
  await $('button=Try the example').click()
  await expect($('[data-testid="fasta-proteins"]')).toHaveText('49 proteins')
  await $('button*=Start search').click()
  await $('[data-testid="search-progress"]').waitForDisplayed({ timeout: 20000 })
  await browser.waitUntil(async () => /Searching/.test(await textOf('[data-testid="search-progress"]')), { timeout: 60000, interval: 100 })
  expect(proseProcesses()).toHaveLength(1)
  expect(appProcesses()).toHaveLength(1)
  expect(searchFolders().partial).toHaveLength(1)
}

const gone = (what: () => unknown[], message: string) => browser.waitUntil(() => what().length === 0, { timeout: 30000, interval: 100, timeoutMsg: message })

describe('closing the window', () => {
  before(async function () {
    if (!enabled) {
      console.log('skipped: set PROSE_BIN to run a search through the app')
      this.skip()
    }
    await appReady()
  })

  afterEach(() => clearSearches())

  it('closing the window ends ProSE', async function () {
    const missing = windowCloseToolsMissing()
    if (missing) {
      console.log(`skipped: the window-manager close ${missing} (see the README)`)
      return this.skip()
    }
    await searchRunning()
    // the close button: the window gets the request of a window manager
    closeWindowLikeAUser(appProcesses()[0].pid)
    await gone(appProcesses, 'the app is still running')
    // no ProSE is left, and the search that was cut short leaves no folder: the app stopped it
    expect(proseProcesses()).toEqual([])
    expect(searchFolders()).toEqual({ finished: [], partial: [] })
    // (the app starts again for the next test)
    await browser.reloadSession()
    await appReady()
  })

  it('a window closed through WebDriver leaves no ProSE either', async () => {
    await searchRunning()
    // Close Window of WebDriver ends the session, and WebKitWebDriver ends the app itself
    await browser.closeWindow().catch(() => {})
    await gone(appProcesses, 'the app is still running')
    expect(proseProcesses()).toEqual([])
  })
})
