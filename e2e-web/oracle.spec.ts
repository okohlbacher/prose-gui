// Oracle tests: what Results shows, checked against the same numbers recomputed here from the fixture's QPX files
// (e2e-web/oracle/: read with hyparquet's object reader in Node, not with the app's reader) by the definitions the
// screens state. A rendering test sees that a number is there; these see that it is the right number.
import { expect, openFixture, test } from './fixtures'
import { parseCsv, parseXlsx } from './oracle/files'
import { byIons, matchIons, MODIFICATION } from './oracle/fragments'
import { coverage, FIXTURE_PSM_FDR, keyFigures, loadFixture, median, peaksOf, qCurve, tabCounts, targetPsms, type OraclePsm } from './oracle/qpx'
import { exportView, keyFigureTiles, openPsm, openTab, parseCount, rowCount } from './oracle/screen'

const count = (n: number) => n.toLocaleString('en-US')
/** the sequence of a ProForma or QPX peptidoform: its residues only */
const residues = (peptide: string) => peptide.replace(/\[[^\]]*\]-?|-(?=\[)/g, '').replace(/[^A-Z]/g, '')

// the fixtures with results: their key figures and tab counts against the oracle
for (const name of ['example', 'suitability', 'no-decoys', 'mods']) {
  test(`${name}: the key figures and the tab counts are those of its PSMs`, async ({ page }) => {
    const f = await loadFixture(name)
    const k = keyFigures(f)
    await openFixture(page, name)
    const tiles = await keyFigureTiles(page)
    expect(tiles.psms.value, 'target PSMs at the PSM FDR').toBe(count(k.psms.length))
    expect(tiles.peptides.value, 'target peptides (forms) at the PSM FDR').toBe(count(k.peptides.size))
    expect(tiles.proteins.value, 'target protein groups').toBe(count(k.proteinGroups))
    if (k.proteins.size !== k.proteinGroups) expect(tiles.proteins.note).toContain(`${count(k.proteins.size)} proteins`)
    // the share of the MS2 spectra that the PSMs identify, and the MS2 count of the tooltip
    expect(tiles.psms.note).toContain(`${((k.spectra / k.ms2) * 100).toFixed(0)} % of MS2`)
    expect(tiles.psms.title).toContain(`${count(k.ms2)} MS2 spectra`)
    // the notes say which FDR controls each count: on the tile itself, so not cut off (an ellipsis would hide it)
    const cut = await page.locator('[data-testid$="-count"], [data-testid="precursor-error"]').evaluateAll((values) =>
      values.flatMap((v) => [...v.parentElement!.children].slice(1)).filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => n.textContent),
    )
    expect(cut, 'key figure notes cut off').toEqual([])
    expect(tiles.error.value, 'median |precursor error|').toBe(k.medianAbsPpm === null ? '–' : `${k.medianAbsPpm.toFixed(1)} ppm`)
    // (and ProSE's reported error is the one its m/z columns give: within float32 precision)
    for (const p of k.psms) if (!Number.isNaN(p.ppm)) expect(Math.abs(p.ppm - p.ppmFromMasses), `${p.sequence} precursor error`).toBeLessThan(0.2)

    const tabs = tabCounts(f)
    const tab = (t: string) => page.getByTestId('results-tabs').getByRole('tab', { name: new RegExp(`^${t}`) })
    await expect(tab('Proteins')).toHaveText(new RegExp(`^Proteins\\s*${count(tabs.proteins)}$`))
    await expect(tab('Peptides')).toHaveText(new RegExp(`^Peptides\\s*${count(tabs.peptides)}$`))
    await expect(tab('PSMs')).toHaveText(new RegExp(`^PSMs\\s*${count(tabs.psms)}$`))
    await openTab(page, 'PSMs')
    expect(await rowCount(page)).toEqual({ shown: tabs.psms, total: tabs.psms })
  })
}

test.describe('example', () => {
  test.beforeEach(async ({ page }) => {
    await openFixture(page)
  })

  test('the Files table: MS2 spectra, target and decoy PSMs per file and in all', async ({ page }) => {
    const f = await loadFixture('example')
    await openTab(page, 'Overview')
    const table = page.locator('table').filter({ has: page.getByRole('columnheader', { name: 'MS2 spectra' }) })
    const header = (await table.locator('thead th').allInnerTexts()).map((t) => t.trim())
    const col = (name: string) => header.indexOf(name)
    const lines = table.locator('tbody tr, tfoot tr')
    for (let r = 0; r < f.runs.length; r++) {
      const cells = (await lines.nth(r).locator('td, th').allInnerTexts()).map((t) => t.trim())
      const psms = f.psms.filter((p) => p.run === r && p.q <= FIXTURE_PSM_FDR)
      expect(cells[col('File')]).toBe(f.inputs[r].name)
      expect(parseCount(cells[col('MS2 spectra')])).toBe(f.runs[r].ms2)
      expect(parseCount(cells[col('Target PSMs')])).toBe(psms.filter((p) => !p.decoy).length)
      expect(parseCount(cells[col('Decoy PSMs')])).toBe(psms.filter((p) => p.decoy).length)
    }
    const all = (await lines.filter({ hasText: 'All files' }).locator('td, th').allInnerTexts()).map((t) => t.trim()).filter(Boolean)
    expect(all.slice(0, 4)).toEqual(['All files', count(keyFigures(f).ms2), count(keyFigures(f).psms.length), '0'])
  })

  test('the Mass accuracy table: what ProSE measured per file', async ({ page }) => {
    const f = await loadFixture('example')
    await openTab(page, 'Overview')
    const table = page.locator('table').filter({ has: page.getByRole('columnheader', { name: 'Recommended precursor tol.' }) })
    for (let r = 0; r < f.runs.length; r++) {
      const { precursor, fragment } = f.runs[r]
      const cells = (await table.locator('tbody tr').nth(r).locator('td').allInnerTexts()).map((t) => t.trim())
      expect(cells).toEqual([
        f.inputs[r].name,
        `${precursor!.median.toFixed(2)} ± ${precursor!.mad.toFixed(2)}`,
        `${precursor!.recommended.toFixed(1)} ppm`,
        `${fragment!.median.toFixed(2)} ± ${fragment!.mad.toFixed(2)}`,
        `${fragment!.recommended.toFixed(1)} ppm`,
      ])
    }
  })

  test('the methods text: the numbers and settings of the provenance', async ({ page }) => {
    const f = await loadFixture('example')
    await openTab(page, 'Overview')
    const text = (await page.getByText(/files? (was|were) searched with ProSE/).innerText()).trim()
    expect(text).toContain(`${f.runs.length} files were searched with ProSE ${f.toolVersion} (OpenMS)`)
    expect(text).toContain(`${count(Number(f.search.get('db_target_proteins')))} target entries`)
    expect(text).toContain(`${count(Number(f.search.get('db_decoy_proteins')))} decoys (${f.search.get('decoy_mode')})`)
    expect(text).toContain(`Enzyme: ${f.search.get('enzyme')}.`)
    for (const [key, name] of [
      ['missed_cleavages', 'peptide:missed_cleavages'],
      ['peptide_min_length', 'peptide:min_size'],
      ['peptide_max_length', 'peptide:max_size'],
      ['precursor_mass_tolerance_lower', 'precursor:mass_tolerance_lower'],
      ['precursor_mass_tolerance_upper', 'precursor:mass_tolerance_upper'],
      ['fragment_mass_tolerance', 'fragment:mass_tolerance'],
      ['fragment_mass_tolerance_unit', 'fragment:mass_tolerance_unit'],
      ['min_charge', 'precursor:min_charge'],
      ['max_charge', 'precursor:max_charge'],
    ]) {
      expect(text, key).toContain(`${name} = ${f.search.get(key)}`)
    }
    expect(text.includes('PSMs were rescored with Percolator')).toBe(f.runs.some((r) => r.rescored))
    expect(text).toContain(`PSMs were filtered at ${FIXTURE_PSM_FDR * 100} % PSM-level FDR (target-decoy). No peptide-level FDR was estimated.`)
    expect(text).toContain(f.fdr.get('protein_fdr_applied') === 'true' ? 'protein-level FDR' : 'No protein-level FDR was applied')
    // the Engine fact names the same version
    await expect(page.getByText(`ProSE ${/^\d+\.\d+/.exec(f.toolVersion)![0]}`, { exact: true })).toBeVisible()
  })

  test('protein coverage: the panel against the sequence and the peptides', async ({ page }) => {
    const f = await loadFixture('example')
    await openTab(page, 'Proteins')
    // the first rows, and the proteins with two peptides
    const accessions = [...(await page.getByTestId('results-table').locator('tbody tr td:first-child').allInnerTexts()).slice(0, 4).map((a) => a.trim()), 'VIMSS14264', 'VIMSS16341']
    for (const accession of accessions) {
      const c = coverage(f, accession)
      expect(c.length, `${accession} has a sequence`).toBeGreaterThan(0)
      await page.getByTestId('filter-bar').getByRole('searchbox').fill(accession)
      await page.getByTestId('results-table').locator('tbody tr', { hasText: accession }).first().click()
      const panel = page.getByTestId('protein-panel')
      await expect(panel.getByTestId('panel-accession')).toHaveText(accession)
      await expect(panel.getByTestId('panel-coverage')).toHaveText(`Coverage ${((c.covered / c.length) * 100).toFixed(1)} %`)
      await expect(panel.getByTestId('panel-peptides')).toHaveText(`${c.peptides.size} ${c.peptides.size === 1 ? 'peptide' : 'peptides'}`)
      await panel.getByRole('tab', { name: /^Coverage/ }).click()
      await expect(panel.getByTestId('coverage-summary')).toContainText(`${count(c.covered)} of ${count(c.length)} residues`)
      await page.keyboard.press('Escape')
      await expect(panel).toBeHidden()
    }
  })

  test('the q-value curve: its end point and its table are the target PSMs and peptides at each cutoff', async ({ page }) => {
    const f = await loadFixture('example')
    const curve = qCurve(f)
    await openTab(page, 'QC')
    const card = page.getByTestId('qc-qcurve')
    const end = curve.at(-1)!
    await expect(card.getByTestId('legend')).toHaveText(new RegExp(`PSMs · ${count(end.psms)}\\s*Peptides · ${count(end.peptides)}`))
    expect(end.psms).toBe(keyFigures(f).psms.length)
    await card.getByText('Table', { exact: true }).click()
    const rows = card.locator('tbody tr')
    const expected = curve.filter((_, s) => s % 5 === 0)
    await expect(rows).toHaveCount(expected.length)
    for (let i = 0; i < expected.length; i++) {
      const [q, psms, peptides] = (await rows.nth(i).locator('td').allInnerTexts()).map((t) => t.trim())
      expect(Number(q.replace('q ≤ ', ''))).toBeCloseTo(expected[i].q, 6)
      expect([parseCount(psms), parseCount(peptides)], `at ${q}`).toEqual([expected[i].psms, expected[i].peptides])
    }
  })

  test('the PSMs per file and the precursor error of QC', async ({ page }) => {
    const f = await loadFixture('example')
    const k = keyFigures(f)
    await openTab(page, 'QC')
    const files = page.getByTestId('qc-files')
    await files.getByText('Table', { exact: true }).click()
    for (let r = 0; r < f.runs.length; r++) {
      await expect(files.locator('tbody tr').nth(r)).toHaveText(new RegExp(`${f.inputs[r].name}\\s*${count(k.psms.filter((p) => p.run === r).length)}`))
    }
    const signed = median(k.psms.map((p) => p.ppm).filter((e) => !Number.isNaN(e)))
    await expect(page.getByTestId('qc-precursor')).toContainText(`${signed >= 0 ? '+' : '−'}${Math.abs(signed).toFixed(1)} ppm`)
    await expect(page.getByTestId('qc-precursor').getByTestId('qc-subtitle')).toContainText(`${count(k.psms.length)} PSMs`)
  })

  test('the targets and decoys line under each charge filter', async ({ page }) => {
    const f = await loadFixture('example')
    await openTab(page, 'PSMs')
    const bar = page.getByTestId('filter-bar')
    const charges = bar.getByRole('group', { name: 'Precursor charges' })
    for (const z of [...new Set(f.psms.map((p) => p.charge))].sort()) {
      const button = charges.getByRole('button', { name: `${z}+` })
      await button.click()
      const all = f.psms.filter((p) => p.charge === z && (p.q <= FIXTURE_PSM_FDR || Number.isNaN(p.q)))
      const targets = all.filter((p) => !p.decoy).length
      const decoys = all.length - targets
      await expect(bar.getByTestId('subset-fdr')).toHaveText(
        `· targets ${count(targets)} · decoys ${count(decoys)} · est. FDR ≈ ${targets > 0 ? ((decoys / targets) * 100).toFixed(1) : '–'} % (within the passing set)`,
      )
      expect((await rowCount(page)).shown).toBe(targets)
      await button.click()
    }
  })

  test('the CSV and Excel exports of each table have its rows and columns, and the oracle values', async ({ page }) => {
    const f = await loadFixture('example')
    const k = keyFigures(f)
    for (const tab of ['Proteins', 'Peptides', 'PSMs'] as const) {
      await openTab(page, tab)
      const csv = await exportView(page, 'CSV')
      expect(csv.name).toBe(`Ecoli-${tab.toLowerCase()}.csv`)
      const rows = parseCsv(csv.bytes.toString('utf8')).filter((r) => r.length > 1 || r[0] !== '')
      const [header, ...body] = rows
      const { shown } = await rowCount(page)
      expect(body.length, `${tab}: the CSV has the rows of the view`).toBe(shown)
      // the table's columns (the count columns of the samples included) are the CSV's, in its order
      const first = page.getByTestId('results-table').locator('tbody tr').first()
      expect(await first.locator('td').count(), `${tab}: as many columns as the table`).toBe(header.length)
      // (the table's short headers and display units, the CSV's long ones and raw units)
      const csvName: Record<string, string> = { z: 'Charge', 'RT (min)': 'RT (s)', 'Error (ppm)': 'Precursor error (ppm)', Coverage: 'Coverage (%)' }
      const named = (await page.getByTestId('results-table').locator('thead tr').first().locator('th').allInnerTexts()).map((t) => t.trim()).filter((t) => t.length > 1)
      for (const c of named) expect(header, `${tab}: column ${c}`).toContain(csvName[c] ?? c)
      // the first rows of the table, cell by cell where the text is the same
      const firstRow = (await page.getByTestId('results-table').locator('tbody tr').first().locator('td').allInnerTexts()).map((t) => t.trim())
      if (tab === 'Proteins') expect(firstRow.slice(0, 2)).toEqual(body[0].slice(0, 2))
      else expect(firstRow[0].replace(/ox/g, '')).toBe(residues(body[0][0]))

      const xlsx = await exportView(page, 'Excel')
      expect(xlsx.name).toBe(`Ecoli-${tab.toLowerCase()}.xlsx`)
      const sheet = parseXlsx(xlsx.bytes)
      expect(sheet[0], `${tab}: the sheet's header is the CSV's`).toEqual(header)
      expect(sheet.length - 1).toBe(body.length)
      for (let r = 0; r < body.length; r++) {
        for (let c = 0; c < header.length; c++) {
          const [a, b] = [body[r][c] ?? '', sheet[r + 1][c] ?? '']
          if (a === b) continue
          expect(Number(b), `${tab} row ${r + 1} ${header[c]}: ${a} vs ${b}`).toBeCloseTo(Number(a), 9)
        }
      }

      const column = (name: string) => body.map((r) => r[header.indexOf(name)])
      if (tab === 'PSMs') {
        // the PSMs: the oracle's, by sequence and charge, with their q-values and precursor errors
        const key = (s: string, z: string | number) => `${residues(s)}/${z}`
        expect(body.map((r) => key(r[header.indexOf('Peptide')], r[header.indexOf('Charge')])).sort()).toEqual(k.psms.map((p) => key(p.sequence, p.charge)).sort())
        expect(column('q-value').map(Number).sort()).toEqual(k.psms.map((p) => p.q).sort())
        const ppm = column('Precursor error (ppm)').map(Number).sort((a, b) => a - b)
        k.psms.map((p) => p.ppm).sort((a, b) => a - b).forEach((e, i) => expect(ppm[i]).toBeCloseTo(e, 6))
      } else if (tab === 'Peptides') {
        const best = new Map<string, number>()
        for (const p of k.psms) best.set(residues(p.peptidoform), Math.min(best.get(residues(p.peptidoform)) ?? 1, p.q))
        expect(new Set(column('Peptide').map(residues))).toEqual(new Set(k.psms.map((p) => p.sequence)))
        body.forEach((r) => expect(Number(r[header.indexOf('Best PSM q-value')])).toBeCloseTo(best.get(residues(r[0]))!, 12))
        // the PSM count of each peptide form
        const psmsOf = new Map<string, number>()
        for (const p of k.psms) psmsOf.set(p.peptidoform, (psmsOf.get(p.peptidoform) ?? 0) + 1)
        expect(column('PSMs').map(Number).reduce((a, b) => a + b, 0)).toBe(k.psms.length)
      } else {
        expect(new Set(column('Accession'))).toEqual(new Set([...k.proteins]))
        for (const r of body) {
          const c = coverage(f, r[0])
          expect(Number(r[header.indexOf('Coverage (%)')]), `${r[0]} coverage`).toBeCloseTo((c.covered / c.length) * 100, 1)
          expect(Number(r[header.indexOf('Peptides')]), `${r[0]} peptides`).toBe(c.peptides.size)
          expect(Number(r[header.indexOf('PSMs')]), `${r[0]} PSMs`).toBe(targetPsms(f).filter((p) => p.proteins.some((m) => m.accession === r[0])).length)
        }
      }
    }
  })
})

/** The PSMs of the example whose ions the tests recompute: plain, Met-oxidised, carbamidomethylated, 3+ and 4+. */
const IONS: { sequence: string; charge?: number }[] = [{ sequence: 'RFYDAVSTFK' }, { sequence: 'YDYGMFK' }, { sequence: 'CTQELLFGK' }, { sequence: 'AREALGLPHSDVFR', charge: 3 }, { sequence: 'AREALGLPHSDVFR', charge: 4 }]

function modsOf(p: OraclePsm): Map<number, number> {
  const out = new Map<number, number>()
  for (const m of p.mods) {
    const mass = MODIFICATION[m.accession]
    if (mass === undefined) throw new Error(`no mass for ${m.accession}`)
    for (const pos of m.positions) out.set(pos, (out.get(pos) ?? 0) + mass)
  }
  // (fixed carbamidomethyl on every C, whether or not QPX lists it)
  ;[...p.sequence].forEach((r, i) => r === 'C' && !out.has(i + 1) && out.set(i + 1, MODIFICATION['UNIMOD:4']))
  return out
}

for (const { sequence, charge } of IONS) {
  test(`${sequence}${charge ? ` ${charge}+` : ''}: the ion table's b/y m/z, the matched ions and the spectrum labels against an independent fragment computation`, async ({ page }) => {
    const f = await loadFixture('example')
    const psm = targetPsms(f).find((p) => p.sequence === sequence && (charge === undefined || p.charge === charge))!
    expect(psm, `${sequence} in the fixture`).toBeTruthy()
    await openFixture(page)
    const view = await openPsm(page, sequence, charge)
    await expect(view.getByTestId('psm-header')).toContainText(`${psm.charge}+ · m/z ${psm.observedMz.toFixed(4)}`)
    await expect(view.getByTestId('psm-header')).toContainText(`q ${Number(psm.q.toPrecision(2))}`)

    const ions = byIons(psm.sequence, modsOf(psm), 1)
    const cells = view.getByTestId('ion-table').locator('td[data-ion]')
    const shown = await cells.evaluateAll((tds) => tds.map((td) => ({ ion: td.getAttribute('data-ion')!, mz: Number(td.textContent!.replace('matched', '').trim()), matched: td.getAttribute('data-matched') === 'true' })))
    const singly = shown.filter((c) => /^[by]\d+$/.test(c.ion))
    expect(singly.map((c) => c.ion).sort()).toEqual(ions.map((i) => i.name).sort())
    for (const c of singly) expect(Math.abs(c.mz - ions.find((i) => i.name === c.ion)!.mz), `${c.ion} m/z`).toBeLessThan(0.0001)

    // matched: an ion with a stored peak within the search's fragment tolerance (Da)
    expect(f.search.get('fragment_mass_tolerance_unit')).toBe('Da')
    const tolerance = Number(f.search.get('fragment_mass_tolerance'))
    const peaks = (await peaksOf(f, psm))!
    expect(peaks, 'the spectrum is stored').toBeTruthy()
    const matched = matchIons(ions, peaks.mz, tolerance)
    expect(singly.filter((c) => c.matched).map((c) => c.ion).sort(), 'matched ions').toEqual([...matched.keys()].sort())
    // the spectrum labels the same ions
    const labels = await view.getByTestId('peak-label').evaluateAll((ts) => ts.flatMap((t) => (t.textContent ?? '').split(/[\s,/]+/).filter(Boolean)))
    expect(labels.filter((l) => /^[by]\d+$/.test(l)).sort(), 'spectrum labels').toEqual([...matched.keys()].sort())
  })
}
