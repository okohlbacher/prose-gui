import { describe, expect, test } from 'vitest'
import type { SpectraFacts } from '../desktop'
import { batchStatus, ms2Analyzer, spectraChecks, spectraLabel } from './spectra'

// The Spectra status (G1 interim): by the flags only, one line per batch, red flags for profile and no MS2.

const facts = (over: Partial<SpectraFacts> = {}): SpectraFacts => ({
  peakPicking: true,
  analyzers: ['orbitrap'],
  levels: { '1': 20, '2': 200 },
  complete: false,
  ms2Centroid: 200,
  ms2Profile: 0,
  ms2WithCharge: 200,
  ms2WithPrecursor: 200,
  activation: { 'beam-type collision-induced dissociation': 200 },
  isolationCentres: 190,
  isolationWidth: 1.6,
  ms2RepeatedTarget: 6,
  ms2Analyzer: { orbitrap: 200 },
  filter: 'FTMS + c NSI d Full ms2 500.00@hcd30.00',
  ...over,
})
const row = (name: string, f: SpectraFacts | null | undefined) => ({ path: `/r/${name}`, name, facts: f })

describe('the spectra status', () => {
  test('labels by the flags; the analyzer from the filter strings first', () => {
    expect(spectraLabel(facts())).toBe('centroid · HCD · orbitrap')
    expect(spectraLabel(facts({ ms2Profile: 200, ms2Centroid: 0 }))).toBe('profile · HCD · orbitrap')
    expect(spectraLabel(facts({ levels: { '1': 50 }, complete: true }))).toBe('no MS2')
    expect(ms2Analyzer(facts({ ms2Analyzer: { 'ion trap': 150, orbitrap: 50 } }))).toBe('ion trap')
    expect(ms2Analyzer(facts({ ms2Analyzer: {}, analyzers: ['orbitrap', 'radial ejection linear ion trap'] }))).toBeNull()
  })

  test('one line for the batch; only the files that differ are marked', () => {
    const s = batchStatus([row('a', facts()), row('b', facts()), row('c', facts({ ms2Profile: 200, ms2Centroid: 0 })), row('d', undefined)])!
    expect(s.line).toBe('centroid · HCD · orbitrap')
    expect([...s.differ]).toEqual([['/r/c', 'profile · HCD · orbitrap']])
    expect(batchStatus([row('d', null)])).toBeNull()
  })

  test('profile, no MS2 and DIA are red flags; missing charges only advice', () => {
    const checks = spectraChecks([
      row('a', facts({ ms2Profile: 200, ms2Centroid: 0 })),
      row('b', facts({ levels: { '1': 100 }, complete: true })),
      row('c', facts({ isolationCentres: 24, isolationWidth: 25, ms2WithCharge: 0 })),
      row('d', facts()),
    ])
    expect(checks.map((c) => [c.id, c.level, c.overridable ?? false, c.files])).toEqual([
      ['profile-ms2', 'block', true, ['/r/a']],
      ['no-ms2', 'block', true, ['/r/b']],
      ['dia-suspected', 'block', true, ['/r/c']],
      ['no-charge', 'info', false, ['/r/c']],
    ])
    // the start of a file without MS2 there is no proof of a file without MS2
    expect(spectraChecks([row('e', facts({ levels: { '1': 100 }, complete: false }))])).toEqual([])
  })
  test('a smaller share of profile MS2 (over 10 %, at most half) is advice, as the diagnosis after the search would name it', () => {
    const ids = (profile: number) => spectraChecks([row('a', facts({ ms2Profile: profile, ms2Centroid: 200 - profile }))]).map((c) => [c.id, c.level])
    expect(ids(60)).toEqual([['profile-ms2-share', 'warn']])
    expect(ids(10)).toEqual([])
    expect(ids(150)).toEqual([['profile-ms2', 'block']])
    expect(spectraChecks([row('a', facts({ ms2Profile: 60, ms2Centroid: 140 }))])[0].message).toMatch(/^a: 30 % of the MS2 spectra read are flagged as profile/)
  })
  test('DIA by recurring isolation targets, however many windows, or by wide windows without charges; DDA passes', () => {
    const dia = (f: SpectraFacts) => spectraChecks([row('x', f)]).some((c) => c.id === 'dia-suspected')
    // 300 narrow Astral windows, read over three cycles: many distinct centres, but each recurs
    expect(dia(facts({ levels: { '2': 1000 }, isolationCentres: 300, isolationWidth: 2, ms2RepeatedTarget: 900, ms2WithCharge: 1000, ms2WithPrecursor: 1000 }))).toBe(true)
    // wide windows without precursor charges, before a full cycle is read
    expect(dia(facts({ isolationCentres: 180, isolationWidth: 8, ms2WithCharge: 0 }))).toBe(true)
    // DDA: new targets almost every time, a few picked again
    expect(dia(facts())).toBe(false)
    // wide-window DDA with charges is not DIA
    expect(dia(facts({ isolationWidth: 8 }))).toBe(false)
  })

  test('files New search does not look into, or could not read, are said to be not checked', () => {
    const checks = spectraChecks([row('a.raw', null), row('b.d', null), row('c.mzML', null), row('d.mzML', undefined), row('e.mzML', facts())])
    const by = (id: string) => checks.find((c) => c.id === id)
    expect(by('spectra-not-checked')).toMatchObject({ level: 'info', files: ['/r/a.raw', '/r/b.d'] })
    expect(by('spectra-not-checked')?.message).toMatch(/^2 files: ProSE reads these formats/)
    expect(by('spectra-not-read')).toMatchObject({ level: 'warn', files: ['/r/c.mzML'] })
  })
})
