// "Why so few identifications?" (guidance G4): the identification rate of each file (identified spectra / MS2
// spectra) against what its setup usually gives, and against the other files of the batch, and the likely causes
// that the search itself reports, ranked by their evidence. Rules over the run view and the result only; nothing
// here judges the data by a single global threshold, because a rate normal for one setup (immunopeptidomics,
// ion-trap CID) is low for another.

import type { DesignResolution } from '../design/model'
import { levelRows } from './figures'
import { baseName, type ResultModel } from './model'
import { searchedWindows, type ToleranceFinding } from './tolerance'
import type { ProSEMultiSummary } from './types'

/** The kind of search a setup is, as far as its identification rate goes. */
export type SetupKind = 'tryptic' | 'iontrap' | 'nonspecific' | 'open'

/**
 * The lowest identification rate (identified spectra / MS2 spectra) that is usual per setup, below which the card
 * asks why. Deliberately low, to fire on failures rather than on ordinary runs: tryptic Orbitrap/Astral/timsTOF
 * DDA runs give 30–70 %; ion-trap CID 10–30 %; non-specific digests (immunopeptidomics) 5–15 % (paper review,
 * threshold table); open searches identify more, not fewer, so they get the tryptic bound.
 */
export const EXPECTED_ID_RATE: Record<SetupKind, number> = { tryptic: 0.15, iontrap: 0.08, nonspecific: 0.03, open: 0.15 }

/**
 * A file is an outlier of its batch below this share of the batch median. The median leaves out the first and last
 * fraction of each fractionated sample (early and late high-pH fractions are thin by design).
 */
export const BATCH_SHARE = 1 / 3
/** A share of profile or out-of-range-charge spectra above this is a cause worth naming. */
export const SPECTRA_SHARE = 0.1
/** Contaminants (trypsin left out: it always ranks) above this share of the target PSMs dominate the result. */
export const CONTAMINANT_SHARE = 0.3
/**
 * A search with fewer target PSMs than this has a coarse FDR and gives Percolator little to learn from: the small-
 * dataset note, for the user's own runs too (it was the example's only).
 */
export const SMALL_RUN_PSMS = 300
/** Percolator's warning when it scored the PSMs by its best single feature (ProSEAlgorithm: usedDefaultDirection). */
export const SINGLE_FEATURE = /single feature|that feature alone/i
/** At most this many causes are listed. */
export const MAX_CAUSES = 3

export function setupKind(parameters: Record<string, unknown>, openSearch: boolean): SetupKind {
  if (openSearch) return 'open'
  if (parameters['peptide:enzyme_specificity'] === 'none' || parameters.enzyme === 'unspecific cleavage') return 'nonspecific'
  if (searchedWindows(parameters).fragment.unit === 'Da') return 'iontrap'
  return 'tryptic'
}

const percent = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)} %`

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length === 0 ? NaN : s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

export type RateRow = { file: string; rate: number | null; low: boolean; outlier: boolean }

/** The identification rate of each file, whether it is low for the setup, and whether it is far below the batch. */
export function idRates(summary: ProSEMultiSummary, design: DesignResolution, kind: SetupKind): RateRow[] {
  const rates = summary.files.map((f) => (f.ms2Spectra > 0 ? f.targetPSMs / f.ms2Spectra : null))
  // the first and last fraction of each fractionated sample stay out of the batch median
  const edge = new Set<number>()
  const bySample = new Map<number, { i: number; fraction: number }[]>()
  design.rows.forEach((r, i) => bySample.set(r.sample, [...(bySample.get(r.sample) ?? []), { i, fraction: r.fraction }]))
  for (const rows of bySample.values()) {
    if (rows.length < 3) continue
    const fr = rows.map((r) => r.fraction)
    const lo = Math.min(...fr)
    const hi = Math.max(...fr)
    for (const r of rows) if (r.fraction === lo || r.fraction === hi) edge.add(r.i)
  }
  const core = rates.filter((r, i): r is number => r !== null && !edge.has(i))
  const batch = core.length >= 3 ? median(core) : NaN
  return summary.files.map((f, i) => {
    const rate = rates[i]
    return {
      file: baseName(f.path),
      rate,
      // (a file without MS2 spectra has no rate, and is the plainest case of a file that identifies nothing)
      low: rate === null || rate < EXPECTED_ID_RATE[kind],
      outlier: rate !== null && !edge.has(i) && rate < BATCH_SHARE * batch,
    }
  })
}

export type Cause = {
  id: string
  /** The cause in a sentence, with its number. */
  message: string
  /** How strong the evidence is (0–1): the causes are listed by it. */
  weight: number
  /** A re-run that fixes it, or the Help section that explains it. */
  reruns: { label: string; changes: Record<string, unknown> }[]
  help?: { label: string; id: string }
}

/** The share of target PSMs (at the search FDR) on contaminants other than trypsin, before any hiding. */
export function contaminantShare(m: ResultModel): number {
  const ps = m.tables.psms
  const pr = m.tables.proteins
  let all = 0
  let con = 0
  for (const i of levelRows(m, 'psms', false)) {
    all++
    const k = ps.peptide[i]
    if (!m.peptide.contaminant[k]) continue
    if (m.peptide.proteins[k].every((p) => /trypsin/i.test(pr.description[p]))) continue
    con++
  }
  return all > 0 ? con / all : 0
}

/** The likely causes of few identifications, strongest first, at most `MAX_CAUSES`. */
export function diagnose(
  summary: ProSEMultiSummary,
  tolerance: ToleranceFinding[],
  contaminants: number,
  isExample: boolean,
): Cause[] {
  const out: Cause[] = []
  const files = summary.files
  const ms2 = files.reduce((n, f) => n + f.ms2Spectra, 0)
  const noMs2 = files.filter((f) => f.ms2Spectra === 0)
  if (noMs2.length > 0) {
    out.push({
      id: 'no-ms2',
      weight: 1,
      message: `${noMs2.length === 1 ? baseName(noMs2[0].path) : `${noMs2.length} files`} had no MS2 spectra, so nothing in ${noMs2.length === 1 ? 'it' : 'them'} was searched.`,
      reruns: [],
    })
  }
  const profile = files.reduce((n, f) => n + (f.profileSpectra ?? 0), 0)
  if (ms2 > 0 && profile / ms2 > SPECTRA_SHARE) {
    out.push({
      id: 'profile-ms2',
      weight: 0.9 * Math.min(1, profile / ms2 + 0.5),
      message: `${percent(profile / ms2)} of the MS2 spectra are in profile mode: centroid them (msconvert's peakPicking filter, or OpenMS' PeakPickerHiRes) and search again.`,
      reruns: [],
    })
  }
  const charge = files.reduce((n, f) => n + (f.chargeOutOfRange?.spectra ?? 0), 0)
  if (ms2 > 0 && charge / ms2 > SPECTRA_SHARE) {
    const c = files.find((f) => f.chargeOutOfRange)!.chargeOutOfRange!
    out.push({
      id: 'charge',
      weight: 0.8 * Math.min(1, charge / ms2 + 0.5),
      message: `${percent(charge / ms2)} of the MS2 spectra were not searched: their precursor charge is outside ${c.min}–${c.max}.`,
      reruns: Number.isFinite(c.min) && Number.isFinite(c.max) ? [{ label: 'Re-run with charges 1–6', changes: { 'precursor:min_charge': 1, 'precursor:max_charge': Math.max(6, c.max) } }] : [],
    })
  }
  const window = tolerance.find((t) => t.id === 'tolerance-offset' || t.id === 'tolerance-edge')
  if (window) out.push({ id: window.id, weight: 0.7, message: window.message, reruns: window.reruns })
  // skipped, or rescored with the best single feature (Percolator's sanity check rejected its model); a file rescored
  // with the model shared by the files of the search (its warning says so) was rescored, not a fallback
  const fallback = files.filter((f) => f.percolator && (!f.percolator.applied || SINGLE_FEATURE.test(f.percolator.warning ?? '')))
  if (fallback.length > 0) {
    out.push({
      id: 'percolator',
      weight: 0.5,
      message: `Percolator was skipped or fell back to a single score for ${fallback.length === files.length ? 'the search' : `${fallback.length} of ${files.length} files`} (Overview › Files says why; usually too few confident PSMs), which passes fewer PSMs.`,
      reruns: [],
      help: { label: 'Percolator and small searches', id: 'faq-percolator-small-run' },
    })
  }
  if (contaminants > CONTAMINANT_SHARE) {
    out.push({
      id: 'contaminants',
      weight: 0.6,
      message: `${percent(contaminants)} of the passing PSMs are contaminants (keratins, albumin and the like; trypsin not counted): the sample may hold little of the organism searched, or the wrong database was chosen.`,
      reruns: [],
    })
  }
  const psms = files.reduce((n, f) => n + f.targetPSMs, 0)
  if (!isExample && psms < SMALL_RUN_PSMS) {
    out.push({
      id: 'small-run',
      weight: 0.3,
      message: `The search has only ${psms} passing PSMs: with so few, the target-decoy FDR is coarse (each decoy weighs much) and Percolator has little to learn from.`,
      reruns: [],
      help: { label: 'Percolator and small searches', id: 'faq-percolator-small-run' },
    })
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, MAX_CAUSES)
}
