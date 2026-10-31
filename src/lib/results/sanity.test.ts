import { describe, expect, test } from 'vitest'
import { sampleDesign, sampleTables } from './fixtures'
import { buildModel } from './model'
import { parameterEcho, sanityFindings, type SanityInput } from './sanity'
import type { ProSEMultiSummary } from './types'

// Post-run checks (G11): plumbing, decoys, isotope peaks, retention times, the parameter echo.

const summary = (files: { path: string; ms2Spectra: number }[], decoyProteins = 4, psmFdr = 0.01) =>
  ({ files, psmFdr, search: { targetProteins: 4, decoyProteins } }) as unknown as ProSEMultiSummary
const model = (edit?: (t: ReturnType<typeof sampleTables>) => void) => {
  const t = sampleTables()
  edit?.(t)
  return buildModel(t, sampleDesign(), { showTechReplicates: false, psmFdr: 1, proteinFdr: 1 })
}
const input = (over: Partial<SanityInput> = {}): SanityInput => ({
  summary: summary([{ path: '/r/ctrl_a.mzML', ms2Spectra: 100 }, { path: '/r/egf_a.mzML', ms2Spectra: 100 }]),
  model: model((t) => t.psms.rt.fill(1800)),
  files: ['ctrl_a.mzML', 'egf_a.mzML'],
  parameters: {},
  ...over,
})
const ids = (s: SanityInput) => sanityFindings(s).map((f) => f.id)

describe('checks of a finished search', () => {
  test('a clean search has none', () => expect(sanityFindings(input())).toEqual([]))

  test('a file without a run, and more MS2 spectra than the file had', () => {
    const s = input({ summary: summary([{ path: '/r/ctrl_a.mzML', ms2Spectra: 100 }]), spectra: { 'ctrl_a.mzML': 80 } })
    const f = sanityFindings(s)
    expect(f.map((x) => x.id)).toEqual(['runs-missing', 'spectra-mismatch'])
    expect(f[0].message).toBe('2 files were searched but the results have 1 runs: egf_a.mzML is missing.')
  })

  test('decoys: none in the database; all q-values 0 in a file with enough PSMs', () => {
    expect(ids(input({ summary: summary([{ path: '/r/ctrl_a.mzML', ms2Spectra: 1 }, { path: '/r/egf_a.mzML', ms2Spectra: 1 }], 0) }))).toEqual(['no-decoys'])
    // a few decoys for many targets (stray DECOY_ entries in the FASTA) is not a target-decoy FDR either
    expect(ids(input({ summary: summary([{ path: '/r/ctrl_a.mzML', ms2Spectra: 1 }, { path: '/r/egf_a.mzML', ms2Spectra: 1 }], 1) }))).toEqual(['decoy-ratio'])
    // the sample has 9 PSMs: too few to call all-zero q-values a fault
    expect(ids(input({ model: model((t) => { t.psms.qValue.fill(0); t.psms.rt.fill(1800) }) }))).toEqual([])
  })

  test('retention times beyond 10 h are in the wrong unit', () => {
    expect(ids(input({ model: model((t) => t.psms.rt.fill(3600 * 60)) }))).toEqual(['rt-unit', 'rt-unit'])
  })

  test('the parameter echo: what ProSE recorded beside what was set', () => {
    const provenance = { enzyme: 'Trypsin/P', precursor_mass_tolerance_lower: '10', fixed_modifications: 'Carbamidomethyl (C)' }
    const echo = parameterEcho({ enzyme: 'Trypsin/P', 'modifications:fixed': ['Carbamidomethyl (C)'] }, provenance)
    expect(echo.every((e) => e.same)).toBe(true)
    expect(ids(input({ parameters: { enzyme: 'Lys-C' }, provenance }))).toEqual(['parameter-echo'])
    expect(sanityFindings(input({ parameters: { enzyme: 'Lys-C' }, provenance }))[0].message).toBe('ProSE used enzyme = Trypsin/P, not Lys-C as set.')
    expect(parameterEcho({}, undefined)).toEqual([])
  })
})
