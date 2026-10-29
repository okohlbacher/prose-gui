// Tolerance feedback after a search (guidance G3): the searched and the recommended mass windows, and whether the
// errors of the passing PSMs say the window was off-centre, too narrow (PSMs pile up at its edge) or wider than
// needed. Built so that it cannot make things worse: ProSE's recommendation is estimated from passing PSMs inside
// the searched window, so it can only ever narrow it; while an offset or a pile-up at the edge is suspected, the
// only re-runs offered are a wider window or (for an offset) calibration, never a narrower one. Calibration sets
// an asymmetric window from a first pass, at most as wide as the one set (ProSEAlgorithm, calibration pass), so it
// follows an offset but cannot bring back PSMs a window cut off: it is not offered for a pile-up at the edge.

import { defaultsOf } from '../settings/parameters'
import { PROSE_PARAMETERS } from '../settings/prose'
import { UNMODIFIED_SHIFT_DA } from '../format/peptide'
import { levelRows } from './figures'
import type { ResultModel } from './model'
import type { ProSEMultiSummary } from './types'

/**
 * An offset is reported when the median error is more than this share of the window on its side: a third of the
 * window lost to an offset leaves true PSMs with larger errors outside it (forum study, FragPipe #1306).
 */
export const OFFSET_SHARE = 1 / 3
/** Offsets below this (ppm) are noise on high-accuracy instruments (Astral-class data have 1 ppm spreads). */
export const MIN_OFFSET_PPM = 1
/** The outer part of the window (share of its width on each side) watched for a pile-up of PSMs. */
export const EDGE_ZONE = 0.1
/**
 * A pile-up: more than this share of the passing PSMs in the outer 10 % of the window. A Gaussian error with the
 * window at 2.5 SD puts about 1 % there; 5 % (the first draft) caught only gross clipping (paper review).
 */
export const EDGE_SHARE = 0.02
/** The window is wider than needed when the recommended one is under this share of it (and the errors are clean). */
export const TOO_WIDE_RATIO = 0.5
/**
 * ProSE measures only matched fragment peaks, all inside the window, so a fragment recommendation can never exceed
 * the window; one this close to it means the errors fill the window (code review: "near it says too narrow").
 */
export const FRAGMENT_NEAR_RATIO = 0.9
/** The wider precursor window offered while an offset or a pile-up is suspected (FragPipe #1306 needed 50 ppm). */
export const WIDE_PROBE_PPM = 50
/** Fewer passing PSMs than this give no reliable median or edge share: no feedback. */
export const MIN_PSMS = 30

export type Window = { lower: number; upper: number; unit: 'ppm' | 'Da' }

/** The precursor and fragment windows a search used: its parameters on top of ProSE's defaults. */
export function searchedWindows(parameters: Record<string, unknown>): { precursor: Window; fragment: Window } {
  const v = { ...defaultsOf(PROSE_PARAMETERS), ...parameters }
  const unit = (x: unknown): 'ppm' | 'Da' => (x === 'Da' ? 'Da' : 'ppm')
  const fragment = Number(v['fragment:mass_tolerance'])
  return {
    precursor: {
      lower: Number(v['precursor:mass_tolerance_lower']),
      upper: Number(v['precursor:mass_tolerance_upper']),
      unit: unit(v['precursor:mass_tolerance_unit']),
    },
    fragment: { lower: fragment, upper: fragment, unit: unit(v['fragment:mass_tolerance_unit']) },
  }
}

/** What the tolerance feedback found; the re-run's changes are ProSE parameters. */
export type ToleranceFinding = {
  id: 'tolerance-offset' | 'tolerance-edge' | 'tolerance-too-wide'
  target: 'precursor' | 'fragment'
  message: string
  reruns: { label: string; changes: Record<string, unknown> }[]
}

/** The precursor errors of the target PSMs at the search FDR, as a share of the window on their side (-1 to 1). */
export type PrecursorSample = { ppm: number[]; position: number[] }

/**
 * The precursor errors (ppm) of the passing target PSMs and their position in the window `w` (error / tolerance
 * on that side; a Da window is converted per PSM at its precursor mass). Open searches and PSMs with a mass shift
 * are left out: the shift is no error.
 */
export function precursorSample(m: ResultModel, w: Window, openSearch: boolean): PrecursorSample {
  const ps = m.tables.psms
  const out: PrecursorSample = { ppm: [], position: [] }
  if (openSearch) return out
  for (const i of levelRows(m, 'psms', false)) {
    const e = ps.precursorErrorPpm[i]
    if (!Number.isFinite(e) || ps.isotopeError[i] !== 0 || Math.abs(ps.deltaMass[i]) > UNMODIFIED_SHIFT_DA) continue
    let side = e < 0 ? w.lower : w.upper
    if (w.unit === 'Da') {
      const mass = ps.mz[i] * ps.charge[i]
      if (!(mass > 0)) continue
      side = (side / mass) * 1e6
    }
    if (!(side > 0)) continue
    out.ppm.push(e)
    out.position.push(e / side)
  }
  return out
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const n = s.length
  return n === 0 ? NaN : n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2
}

const ppmLabel = (x: number) => `${Number(x.toFixed(1))} ppm`

/** The changes of a symmetric precursor window of `ppm`. */
const precursorWindow = (ppm: number) => ({
  'precursor:mass_tolerance_lower': ppm,
  'precursor:mass_tolerance_upper': ppm,
  'precursor:mass_tolerance_unit': 'ppm',
})
const CALIBRATE = { label: 'Re-run with calibration', changes: { 'calibration:enabled': true } }

/**
 * The tolerance findings of a search: offset and pile-up at the edge (too narrow), then too wide. `parameters` are
 * the search's (`settings.parameters`), `sample` its precursor errors (`precursorSample`).
 */
export function toleranceFindings(summary: ProSEMultiSummary, parameters: Record<string, unknown>, sample: PrecursorSample): ToleranceFinding[] {
  if (summary.openSearch) return []
  const w = searchedWindows(parameters)
  const calibrated = parameters['calibration:enabled'] === true
  const out: ToleranceFinding[] = []
  const wider: ToleranceFinding['reruns'] = []
  const widest = Math.max(w.precursor.lower, w.precursor.upper)
  // a Da window is widened in Da (±50 ppm would narrow a ±0.5 Da window: about ±500 ppm at 1,000 Da)
  if (w.precursor.unit === 'Da') {
    const da = Number((2 * widest).toPrecision(3))
    wider.push({ label: `Re-run with ±${da} Da`, changes: { 'precursor:mass_tolerance_lower': da, 'precursor:mass_tolerance_upper': da, 'precursor:mass_tolerance_unit': 'Da' } })
  } else if (widest < WIDE_PROBE_PPM) wider.push({ label: `Re-run with ±${WIDE_PROBE_PPM} ppm`, changes: precursorWindow(WIDE_PROBE_PPM) })

  // the precursor: from the passing PSMs themselves
  let precursorClean = false
  if (sample.ppm.length >= MIN_PSMS) {
    const mid = median(sample.ppm)
    const position = median(sample.position)
    const offset = Math.abs(position) > OFFSET_SHARE && Math.abs(mid) >= MIN_OFFSET_PPM
    const edge = sample.position.filter((p) => Math.abs(p) > 1 - EDGE_ZONE).length / sample.position.length
    // calibration only narrows the window (ProSE clamps it to the one set): it follows an offset but cannot bring back
    // PSMs the window cut off, so it is offered only while nothing piles up at the edge
    const clipped = edge > EDGE_SHARE
    if (offset) {
      out.push({
        id: 'tolerance-offset',
        target: 'precursor',
        message:
          `The precursor errors are off-centre: their median is ${mid > 0 ? '+' : ''}${ppmLabel(mid)}, more than a third of the ` +
          'window on that side. PSMs with larger errors may have fallen outside it. Search again with a wider window (calibration can then narrow it ' +
          'around the offset); a narrower window would lose more.',
        reruns: clipped || calibrated ? wider : [...wider, CALIBRATE],
      })
    }
    if (clipped) {
      out.push({
        id: 'tolerance-edge',
        target: 'precursor',
        message:
          `${(edge * 100).toFixed(1)} % of the passing PSMs lie in the outer tenth of the precursor window: the window cuts the ` +
          'error distribution. Search again with a wider window.',
        reruns: wider,
      })
    }
    precursorClean = !offset && edge <= EDGE_SHARE
  }
  const recommended = (pick: 'precursorError' | 'fragmentError') => {
    const values = summary.files.map((f) => f[pick]?.recommended).filter((x): x is number => typeof x === 'number' && x > 0)
    return values.length === summary.files.length && values.length > 0 ? Math.max(...values) : null
  }
  const precursorRecommended = recommended('precursorError')
  if (precursorClean && w.precursor.unit === 'ppm' && precursorRecommended !== null) {
    const narrow = Math.min(w.precursor.lower, w.precursor.upper)
    if (precursorRecommended < TOO_WIDE_RATIO * narrow) {
      const ppm = Math.ceil(precursorRecommended)
      out.push({
        id: 'tolerance-too-wide',
        target: 'precursor',
        message:
          `The precursor window (−${w.precursor.lower} / +${w.precursor.upper} ppm) is more than twice what the errors need: ProSE ` +
          `recommends ${ppmLabel(precursorRecommended)} for every file. A narrower window separates targets from decoys better.`,
        reruns: [{ label: `Re-run with ±${ppm} ppm`, changes: precursorWindow(ppm) }],
      })
    }
  }

  // the fragments: only the per-file estimates are stored, and only ppm windows can be compared with them
  if (w.fragment.unit === 'ppm') {
    const tol = w.fragment.upper
    const files = summary.files.filter((f) => f.fragmentError)
    const off = files.filter((f) => Math.abs(f.fragmentError!.median) > OFFSET_SHARE * tol && Math.abs(f.fragmentError!.median) >= MIN_OFFSET_PPM)
    const full = files.filter((f) => f.fragmentError!.recommended >= FRAGMENT_NEAR_RATIO * tol)
    const fragmentWider = [
      { label: `Re-run with ${2 * tol} ppm fragments`, changes: { 'fragment:mass_tolerance': 2 * tol } },
      ...(calibrated ? [] : [CALIBRATE]),
    ]
    if (off.length > 0) {
      out.push({
        id: 'tolerance-offset',
        target: 'fragment',
        message:
          `The fragment errors are off-centre in ${off.length === files.length ? 'every file' : `${off.length} of ${files.length} files`} ` +
          `(median up to ${ppmLabel(Math.max(...off.map((f) => Math.abs(f.fragmentError!.median))))} of a ${tol} ppm window). ` +
          'Search again with calibration or a wider fragment window.',
        reruns: full.length > 0 ? fragmentWider.filter((r) => r !== CALIBRATE) : fragmentWider,
      })
    }
    if (full.length > 0) {
      out.push({
        id: 'tolerance-edge',
        target: 'fragment',
        message:
          `The fragment errors fill the ${tol} ppm window in ${full.length === files.length ? 'every file' : `${full.length} of ${files.length} files`}: ` +
          'ProSE only sees peaks inside it, so the true spread may be wider. Search again with a wider fragment window.',
        reruns: fragmentWider.filter((r) => r !== CALIBRATE),
      })
    }
    const fragmentRecommended = recommended('fragmentError')
    if (off.length === 0 && full.length === 0 && fragmentRecommended !== null && fragmentRecommended < TOO_WIDE_RATIO * tol) {
      const ppm = Math.ceil(fragmentRecommended)
      out.push({
        id: 'tolerance-too-wide',
        target: 'fragment',
        message: `The fragment window (${tol} ppm) is more than twice what the errors need: ProSE recommends ${ppmLabel(fragmentRecommended)} for every file.`,
        reruns: [{ label: `Re-run with ${ppm} ppm fragments`, changes: { 'fragment:mass_tolerance': ppm } }],
      })
    }
  }
  return out
}

/** The windows to draw on the precursor error histogram (ppm, relative to 0); null for Da windows. */
export function precursorRanges(summary: ProSEMultiSummary, parameters: Record<string, unknown>): { from: number; to: number; label: string; kind: 'searched' | 'recommended' }[] {
  const w = searchedWindows(parameters).precursor
  if (summary.openSearch || w.unit !== 'ppm') return []
  const out: { from: number; to: number; label: string; kind: 'searched' | 'recommended' }[] = [
    { from: -w.lower, to: w.upper, label: 'searched', kind: 'searched' },
  ]
  const rec = summary.files.map((f) => f.precursorError?.recommended).filter((x): x is number => typeof x === 'number' && x > 0)
  if (rec.length > 0) {
    const r = Math.max(...rec)
    out.push({ from: -r, to: r, label: 'recommended', kind: 'recommended' })
  }
  return out
}
