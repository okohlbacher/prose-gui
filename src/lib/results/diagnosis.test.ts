import { describe, expect, test } from 'vitest'
import { resolveDesign } from '../design/model'
import { diagnose, idRates, setupKind, SMALL_RUN_PSMS } from './diagnosis'
import type { ProSEFileSummary, ProSEMultiSummary } from './types'

// The diagnosis card (G4): rates against the setup and the batch, causes ranked by evidence.

const file = (name: string, ms2: number, targets: number, extra: Partial<ProSEFileSummary> = {}): ProSEFileSummary =>
  ({ path: `/r/${name}`, ms2Spectra: ms2, targetPSMs: targets, decoyPSMs: 1, percolator: { applied: true, skipped: null, warning: null }, ...extra }) as ProSEFileSummary
const summary = (files: ProSEFileSummary[]) => ({ files, openSearch: false }) as unknown as ProSEMultiSummary
const design = (n: number, fractions = false) =>
  resolveDesign(Array.from({ length: n }, (_, i) => ({ id: `f${i}`, fileName: `${i}.mzML`, fileSize: 1, condition: 'a', replicate: 1, ...(fractions ? { fraction: i + 1 } : {}) })))

describe('the diagnosis', () => {
  test('the setup decides what is low: 10 % is low for tryptic Orbitrap, normal for a non-specific digest', () => {
    expect(setupKind({}, false)).toBe('tryptic')
    expect(setupKind({ 'fragment:mass_tolerance_unit': 'Da' }, false)).toBe('iontrap')
    expect(setupKind({ 'peptide:enzyme_specificity': 'none' }, false)).toBe('nonspecific')
    const s = summary([file('a', 1000, 100)])
    expect(idRates(s, design(1), 'tryptic')[0]).toMatchObject({ rate: 0.1, low: true })
    expect(idRates(s, design(1), 'nonspecific')[0].low).toBe(false)
  })

  test('a batch outlier is far below the median; the first and last fraction are neither counted nor flagged', () => {
    const s = summary([file('0', 1000, 30), file('1', 1000, 400), file('2', 1000, 100), file('3', 1000, 420), file('4', 1000, 410), file('5', 1000, 20)])
    const rows = idRates(s, design(6, true), 'nonspecific')
    expect(rows.map((r) => r.outlier)).toEqual([false, false, true, false, false, false])
  })

  test('the causes, strongest first, at most three; the small-run note only for the user\'s runs', () => {
    const files = [
      file('a', 1000, 50, { profileSpectra: 600 }),
      file('b', 0, 0),
      file('c', 1000, 40, { percolator: { applied: false, skipped: 'Only 40 PSMs', warning: null } }),
    ]
    const causes = diagnose(summary(files), [], 0.5, false)
    expect(causes.map((c) => c.id)).toEqual(['no-ms2', 'profile-ms2', 'contaminants'])
    expect(causes[1].message).toMatch(/^30 % of the MS2 spectra are in profile mode/)
    const few = diagnose(summary([file('a', 1000, 20)]), [], 0, false)
    expect(few.map((c) => c.id)).toEqual(['small-run'])
    expect(few[0].message).toContain('only 20 passing PSMs')
    expect(diagnose(summary([file('a', 1000, 20)]), [], 0, true)).toEqual([])
    expect(diagnose(summary([file('a', 1000, SMALL_RUN_PSMS)]), [], 0, false)).toEqual([])
  })

  test('a window that cuts the errors is a cause, with its re-runs', () => {
    const finding = { id: 'tolerance-offset' as const, target: 'precursor' as const, message: 'Off-centre.', reruns: [{ label: 'Re-run with ±50 ppm', changes: {} }] }
    expect(diagnose(summary([file('a', 1000, 500)]), [finding], 0, false)).toEqual([{ id: 'tolerance-offset', weight: 0.7, message: 'Off-centre.', reruns: finding.reruns }])
  })
})

test('contaminants are counted before any hiding, trypsin left out', async () => {
  const { sampleDesign, sampleTables } = await import('./fixtures')
  const { buildModel } = await import('./model')
  const { contaminantShare } = await import('./diagnosis')
  const model = (desc: string) => {
    const t = sampleTables()
    t.proteins.description[2] = desc
    return buildModel(t, sampleDesign(), { showTechReplicates: false, psmFdr: 1, proteinFdr: 1 })
  }
  expect(contaminantShare(model('Trypsin'))).toBe(0)
  expect(contaminantShare(model('Keratin, type II'))).toBeGreaterThan(0)
})
