// Projects (.prose-setup.json) in the browser: Save project downloads the setup (the desktop app's save dialog is the
// browser's download here), Open project reads one with the browser's file picker (the open dialog's stand-in). The
// browser reads no file, so every input of an opened project is reported as missing; its search, in the in-memory
// History of the fixture, opens in Results with the saved tab and filter.
import { readFile } from 'node:fs/promises'
import { expect, openFixture, test } from './fixtures'

test('Save project downloads the setup as JSON', async ({ page }) => {
  await page.goto('/#/search')
  await page.locator('#preset').click()
  await page.getByRole('option', { name: 'Ion trap CID · tryptic' }).click()
  const download = page.waitForEvent('download')
  await page.getByTestId('save-setup').click()
  const file = await download
  expect(file.suggestedFilename()).toBe('project.prose-setup.json')
  const setup = JSON.parse(await readFile((await file.path())!, 'utf8'))
  expect(setup).toMatchObject({ format: 'prose-setup', schema: 1, inputs: [], database: null, ui: { view: 'search' } })
  expect(setup.presetId).toMatch(/ion-?trap/i)
  expect(typeof setup.appVersion).toBe('string')
  await expect(page.getByTestId('project-name')).toHaveText('Project: project')
})

test('Open project restores New search, names the missing files, and opens its search in Results', async ({ page }) => {
  await openFixture(page)
  const setup = {
    format: 'prose-setup',
    schema: 1,
    name: 'exp',
    inputs: [
      { path: '/data/run_1.mzML', name: 'run_1.mzML', size: 1000, condition: 'a' },
      { path: '/data/run_2.mzML', name: 'run_2.mzML', size: 1000, condition: 'b' },
    ],
    database: { path: '/db/ecoli.fasta', name: 'ecoli.fasta', size: 5000, proteome: null },
    presetId: 'orbitrap-hcd-tryptic',
    parameters: {},
    search: { id: '100-0', name: 'example' },
    ui: {
      view: 'results',
      showSettings: false,
      advanced: false,
      results: {
        tab: 'peptides',
        levels: {
          proteins: { filters: { text: '', maxQ: null, minPeptides: 0, minReplicatesInCondition: 0, hideContaminants: true, showDecoys: false }, sort: { key: 'psms', dir: 'desc' }, hidden: [], selected: null },
          peptides: { filters: { text: 'ZZZNOMATCH', maxQ: null, minPeptides: 0, minReplicatesInCondition: 0, hideContaminants: true, showDecoys: false }, sort: { key: 'psms', dir: 'desc' }, hidden: [], selected: null },
          psms: { filters: { text: '', maxQ: null, minPeptides: 0, minReplicatesInCondition: 0, hideContaminants: true, showDecoys: false }, sort: { key: 'qValue', dir: 'asc' }, hidden: [], selected: null },
        },
      },
    },
  }
  // (the fixture's search is in History once the page has saved it)
  await expect(page).toHaveURL(/#\/results\/100-0$/)
  await page.getByRole('link', { name: 'New search' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('open-setup').click()
  await (await chooser).setFiles({ name: 'exp.prose-setup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(setup)) })
  // its search opens in Results, on the tab and with the filter it was saved with
  await expect(page).toHaveURL(/#\/results\/100-0$/)
  await expect(page.getByRole('tab', { name: /^Peptides/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[data-testid="filter-bar"] input[type="search"]')).toHaveValue('ZZZNOMATCH')
  await expect(page.getByText('“exp” opened with')).toBeVisible()
  // New search: the files that are not there are named, the project is the window's
  await page.getByRole('link', { name: 'New search' }).click()
  await expect(page.getByText(/From “exp”, these files are no longer there: run_1\.mzML, run_2\.mzML/)).toBeVisible()
  await expect(page.getByText(/Choose the database of “exp” again: ecoli\.fasta/)).toBeVisible()
  await expect(page.getByTestId('project-name')).toHaveText('Project: exp')
})

test('a project of a newer ProSE is refused with a message', async ({ page }) => {
  await page.goto('/#/search')
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('open-setup').click()
  await (await chooser).setFiles({ name: 'new.prose-setup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'prose-setup', schema: 99, inputs: [] })) })
  await expect(page.getByTestId('project-error')).toContainText('saved by a newer ProSE (project schema 99')
})
