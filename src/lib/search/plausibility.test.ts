import { describe, expect, test } from 'vitest'
import type { SpectraFacts } from '../desktop'
import { plausibilityChecks } from './plausibility'

// Plausibility of the settings (review measure 7): advice on values that rarely fit the data.

const facts = (ms2: string, analyzers = ['orbitrap']): SpectraFacts =>
  ({ analyzers, ms2Analyzer: { [ms2]: 100 }, levels: { '2': 100 } }) as unknown as SpectraFacts
const orbitrap = { path: '/r/a.mzML', name: 'a.mzML', instrument: 'Q Exactive HF', facts: facts('orbitrap') }
const hybridTrap = { path: '/r/b.mzML', name: 'b.mzML', instrument: 'LTQ Orbitrap Velos', facts: facts('ion trap', ['orbitrap', 'radial ejection linear ion trap']) }
const pureTrap = { path: '/r/c.mzML', name: 'c.mzML', instrument: 'LTQ XL', facts: facts('ion trap', ['radial ejection linear ion trap']) }
const usual = {
  'modifications:variable': ['Oxidation (M)'],
  'fragment:mass_tolerance': 20,
  'fragment:mass_tolerance_unit': 'ppm',
  'precursor:mass_tolerance_lower': 10,
  'precursor:mass_tolerance_upper': 10,
  'precursor:mass_tolerance_unit': 'ppm',
}
const ids = (values: Record<string, unknown>, files = [orbitrap]) =>
  plausibilityChecks({ values: { ...usual, ...values }, files, set: () => {} }).map((c) => c.id)

describe('the plausibility of the settings', () => {
  test('usual settings on Orbitrap data, and ion-trap settings on hybrid ion-trap MS2, give no advice', () => {
    expect(ids({})).toEqual([])
    expect(ids({ 'fragment:mass_tolerance': 0.5, 'fragment:mass_tolerance_unit': 'Da' }, [hybridTrap])).toEqual([])
  })

  test('many variable modifications, and fragment tolerances no instrument has', () => {
    expect(ids({ 'modifications:variable': ['Oxidation (M)', 'Acetyl (Protein N-term)', 'Phospho (S)', 'Phospho (T)'] })).toEqual(['many-variable-mods'])
    expect(ids({ 'fragment:mass_tolerance': 20, 'fragment:mass_tolerance_unit': 'Da' })).toEqual(['fragment-tolerance-wide'])
    expect(ids({ 'fragment:mass_tolerance': 0.5, 'fragment:mass_tolerance_unit': 'ppm' })).toEqual(['fragment-tolerance-narrow'])
  })

  test('a Da fragment window on high-resolution MS2: advice with a 20 ppm fix', () => {
    const set: [string, unknown][] = []
    const [c] = plausibilityChecks({
      values: { ...usual, 'fragment:mass_tolerance': 0.5, 'fragment:mass_tolerance_unit': 'Da' },
      files: [orbitrap, hybridTrap],
      set: (n, v) => set.push([n, v]),
    })
    expect(c).toMatchObject({ id: 'fragment-da-highres', level: 'warn', files: ['/r/a.mzML'] })
    c.action!.run()
    expect(set).toEqual([['fragment:mass_tolerance', 20], ['fragment:mass_tolerance_unit', 'ppm']])
  })

  test('a precursor window in Da on high-resolution MS1: 10 Da reads as a unit slip, 0.5 Da as too wide; an open search is left alone', () => {
    const da = (v: number) => ({ 'precursor:mass_tolerance_lower': v, 'precursor:mass_tolerance_upper': v, 'precursor:mass_tolerance_unit': 'Da' })
    const set: [string, unknown][] = []
    const [typo] = plausibilityChecks({ values: { ...usual, ...da(10) }, files: [orbitrap], set: (n, v) => set.push([n, v]) })
    expect(typo).toMatchObject({ id: 'precursor-da-typo' })
    expect(typo.message).toMatch(/did you mean 10 ppm\?/)
    typo.action!.run()
    expect(set).toEqual([['precursor:mass_tolerance_unit', 'ppm']])
    expect(ids(da(0.5))).toEqual(['precursor-da-wide'])
    expect(ids(da(500))).toEqual([])
    // a hybrid's MS1 is high resolution too
    expect(ids(da(10), [hybridTrap])).toEqual(['precursor-da-typo'])
  })

  test('a ppm precursor window on a pure ion trap, whose MS1 is low resolution', () => {
    expect(ids({ 'fragment:mass_tolerance': 0.5, 'fragment:mass_tolerance_unit': 'Da' }, [pureTrap])).toEqual(['iontrap-precursor-ppm'])
    expect(
      ids(
        { 'fragment:mass_tolerance': 0.5, 'fragment:mass_tolerance_unit': 'Da', 'precursor:mass_tolerance_lower': 1.5, 'precursor:mass_tolerance_upper': 1.5, 'precursor:mass_tolerance_unit': 'Da' },
        [pureTrap],
      ),
    ).toEqual([])
  })
})
