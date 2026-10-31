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

  test('profile and no MS2 are red flags; repeated windows and missing charges only advice', () => {
    const checks = spectraChecks([
      row('a', facts({ ms2Profile: 200, ms2Centroid: 0 })),
      row('b', facts({ levels: { '1': 100 }, complete: true })),
      row('c', facts({ isolationCentres: 24, isolationWidth: 25, ms2WithCharge: 0 })),
      row('d', facts()),
    ])
    expect(checks.map((c) => [c.id, c.level, c.overridable ?? false, c.files])).toEqual([
      ['profile-ms2', 'block', true, ['/r/a']],
      ['no-ms2', 'block', true, ['/r/b']],
      ['dia-suspected', 'warn', false, ['/r/c']],
      ['no-charge', 'info', false, ['/r/c']],
    ])
    // the start of a file without MS2 there is no proof of a file without MS2
    expect(spectraChecks([row('e', facts({ levels: { '1': 100 }, complete: false }))])).toEqual([])
  })
  test('files New search does not look into, or could not read, are said to be not checked', () => {
    const checks = spectraChecks([row('a.raw', null), row('b.d', null), row('c.mzML', null), row('d.mzML', undefined), row('e.mzML', facts())])
    const by = (id: string) => checks.find((c) => c.id === id)
    expect(by('spectra-not-checked')).toMatchObject({ level: 'info', files: ['/r/a.raw', '/r/b.d'] })
    expect(by('spectra-not-checked')?.message).toMatch(/^2 files: ProSE reads these formats/)
    expect(by('spectra-not-read')).toMatchObject({ level: 'warn', files: ['/r/c.mzML'] })
  })
})
