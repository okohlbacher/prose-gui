import { describe, expect, test } from 'vitest'
import { precursorRanges, searchedWindows, toleranceFindings, WIDE_PROBE_PPM, type PrecursorSample } from './tolerance'
import type { ProSEFileSummary, ProSEMultiSummary } from './types'

// Tolerance feedback (G3): an off-centre or clipped window gets only wider re-runs, a clean wide one a narrower one.

const file = (precursorRec: number, fragment = { median: 0.5, mad: 2, recommended: 12 }): ProSEFileSummary =>
  ({ path: 'a.mzML', precursorError: { median: 0, mad: 1, recommended: precursorRec }, fragmentError: fragment }) as unknown as ProSEFileSummary
const summary = (files: ProSEFileSummary[], openSearch = false) => ({ files, openSearch }) as unknown as ProSEMultiSummary
/** `n` errors spread evenly over [centre - spread, centre + spread] in a ±10 ppm window. */
const sample = (centre: number, spread: number, n = 200, tol = 10): PrecursorSample => {
  const ppm = Array.from({ length: n }, (_, i) => centre + spread * (2 * (i / (n - 1)) - 1))
  return { ppm, position: ppm.map((e) => e / tol) }
}
const ids = (f: ReturnType<typeof toleranceFindings>) => f.map((x) => `${x.target}:${x.id}`)
const narrower = (f: ReturnType<typeof toleranceFindings>) =>
  f.flatMap((x) => x.reruns).some((r) => Number(r.changes['precursor:mass_tolerance_upper'] ?? Infinity) < 10)

describe('tolerance feedback', () => {
  test('the searched windows: the parameters on ProSE defaults', () => {
    expect(searchedWindows({}).precursor).toEqual({ lower: 10, upper: 10, unit: 'ppm' })
    expect(searchedWindows({ 'fragment:mass_tolerance': 0.5, 'fragment:mass_tolerance_unit': 'Da' }).fragment).toEqual({ lower: 0.5, upper: 0.5, unit: 'Da' })
  })

  test('an offset of 5 ppm in a 10 ppm window: wider window or calibration, never narrower', () => {
    const f = toleranceFindings(summary([file(3)]), {}, sample(5, 3))
    expect(ids(f)).toContain('precursor:tolerance-offset')
    expect(narrower(f)).toBe(false)
    expect(f[0].reruns.map((r) => r.label)).toEqual([`Re-run with ±${WIDE_PROBE_PPM} ppm`, 'Re-run with calibration'])
    // (the recommendation of 3 ppm would say "too wide": it is not offered while the offset holds)
    expect(ids(f)).not.toContain('precursor:tolerance-too-wide')
  })

  test('a pile-up at the edge (over 2 % in the outer tenth) is "too narrow"', () => {
    const f = toleranceFindings(summary([file(9)]), {}, sample(0, 10))
    expect(ids(f)).toEqual(['precursor:tolerance-edge'])
    expect(narrower(f)).toBe(false)
  })

  test('a clean spread whose recommendation is under half the window: re-run with the recommendation', () => {
    const f = toleranceFindings(summary([file(3.2)]), {}, sample(0.3, 2))
    expect(ids(f)).toEqual(['precursor:tolerance-too-wide'])
    expect(f[0].reruns[0]).toEqual({ label: 'Re-run with ±4 ppm', changes: { 'precursor:mass_tolerance_lower': 4, 'precursor:mass_tolerance_upper': 4, 'precursor:mass_tolerance_unit': 'ppm' } })
  })

  test('offsets under 1 ppm are noise; few PSMs and open searches give nothing', () => {
    // 0.9 ppm median in a ±2 ppm window is over a third, but under 1 ppm
    expect(toleranceFindings(summary([file(1.9)]), { 'precursor:mass_tolerance_lower': 2, 'precursor:mass_tolerance_upper': 2 }, { ppm: Array(100).fill(0.9), position: Array(100).fill(0.45) })).toEqual([])
    expect(toleranceFindings(summary([file(3)]), {}, sample(5, 3, 10))).toEqual([])
    expect(toleranceFindings(summary([file(3)], true), {}, sample(5, 3))).toEqual([])
  })

  test('fragments: offset and a full window ask for wider; a Da window is not judged', () => {
    const off = toleranceFindings(summary([file(9, { median: 9, mad: 2, recommended: 15 })]), {}, sample(0, 2))
    expect(ids(off)).toEqual(['fragment:tolerance-offset'])
    expect(off[0].reruns[0].changes).toEqual({ 'fragment:mass_tolerance': 40 })
    const full = toleranceFindings(summary([file(9, { median: 1, mad: 6, recommended: 19 })]), {}, sample(0, 2))
    expect(ids(full)).toEqual(['fragment:tolerance-edge'])
    const wide = toleranceFindings(summary([file(9, { median: 1, mad: 1, recommended: 4.2 })]), {}, sample(0, 2))
    expect(ids(wide)).toEqual(['fragment:tolerance-too-wide'])
    expect(wide[0].reruns[0].changes).toEqual({ 'fragment:mass_tolerance': 5 })
    expect(toleranceFindings(summary([file(9, { median: 9, mad: 2, recommended: 15 })]), { 'fragment:mass_tolerance': 0.5, 'fragment:mass_tolerance_unit': 'Da' }, sample(0, 2))).toEqual([])
  })

  test('the ranges drawn on the histogram: asymmetric searched window and the recommended one', () => {
    expect(precursorRanges(summary([file(3), file(4)]), { 'precursor:mass_tolerance_lower': 5, 'precursor:mass_tolerance_upper': 20 })).toEqual([
      { from: -5, to: 20, label: 'searched', kind: 'searched' },
      { from: -4, to: 4, label: 'recommended', kind: 'recommended' },
    ])
    expect(precursorRanges(summary([file(3)]), { 'precursor:mass_tolerance_unit': 'Da' })).toEqual([])
  })
})
