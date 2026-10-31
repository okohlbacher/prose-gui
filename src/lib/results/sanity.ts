// Checks of a finished search (guidance G11) for what goes wrong silently: an input that produced no run, fewer
// spectra searched than the file has, decoys that were not recognised, many precursors matched off their
// monoisotopic peak, retention times in the wrong unit, and settings that ProSE did not use as asked. From the
// run view, the PSMs and the provenance; each says what it saw.

import { defaultsOf, sameValue } from '../settings/parameters'
import { PROSE_PARAMETERS } from '../settings/prose'
import { levelRows } from './figures'
import { baseName, type ResultModel } from './model'
import { qpxParameters } from './summary'
import type { ProSEMultiSummary } from './types'
import { DECOY_RATIO } from '../search/database'

/**
 * All q-values 0 in a file with at least this many PSMs: decoys were probably not told from targets (a decoy marker
 * the search did not recognise), so every PSM looks certain. Without Percolator, ProSE's target-decoy q-values (D/T)
 * of PSMs that score above every decoy are 0 too, so the finding says to check, not that the FDR is wrong.
 */
export const ALL_Q_ZERO_MIN_PSMS = 50
/**
 * Passing PSMs matched to an isotope peak other than the monoisotopic one (ProSE's isotope error) above this share:
 * the precursor m/z of the file is often off by one 13C spacing (instrument or conversion picks the wrong peak).
 * A few percent is normal with isotope-error search on (forum study: 16 threads on isotope-off precursors).
 */
export const ISOTOPE_SHARE = 0.25
/** At least this many passing PSMs are needed to judge the isotope share. */
export const ISOTOPE_MIN_PSMS = 100
/**
 * Retention times (s) of identifications beyond this are no LC run (10 h): minutes read as seconds × 60, or
 * milliseconds; below `RT_MIN_S` with many spectra, seconds that were minutes (forum study: 6 threads).
 */
export const RT_MAX_S = 36_000
export const RT_MIN_S = 120
/** A file needs this many MS2 spectra for the short-run rule (a short test run is fine). */
export const RT_MIN_SPECTRA = 2_000

export type SanityFinding = { id: string; message: string }

export type SanityInput = {
  summary: ProSEMultiSummary
  model: ResultModel
  /** The searched files of the design, by name, in order. */
  files: string[]
  /** The spectra of each mzML's header at the start, by file name (`OpenResult.spectra`). */
  spectra?: Record<string, number>
  /** The parameters asked for (`settings.parameters`) and what ProSE recorded (`outcome.provenance`). */
  parameters: Record<string, unknown>
  provenance?: Record<string, string>
}

export function sanityFindings(s: SanityInput): SanityFinding[] {
  const out: SanityFinding[] = []
  const { summary, model: m } = s
  // plumbing: every input a run, no run with more MS2 spectra than its file had spectra
  if (summary.files.length < s.files.length) {
    const seen = new Set(summary.files.map((f) => baseName(f.path)))
    const missing = s.files.filter((n) => !seen.has(n))
    out.push({
      id: 'runs-missing',
      message: `${s.files.length} files were searched but the results have ${summary.files.length} runs${missing.length > 0 ? `: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ' and more' : ''} ${missing.length === 1 ? 'is' : 'are'} missing` : ''}.`,
    })
  }
  for (const f of summary.files) {
    const header = s.spectra?.[baseName(f.path)]
    if (header !== undefined && f.ms2Spectra > header) {
      out.push({
        id: 'spectra-mismatch',
        message: `${baseName(f.path)}: ProSE counted ${f.ms2Spectra} MS2 spectra, but the file's header lists ${header} spectra in all. The file may have changed since it was added, or its spectra are numbered twice.`,
      })
    }
  }
  // decoys: none in the database, or q-values that never rise above 0
  if (summary.psmFdr > 0 && summary.search.decoyProteins === 0 && summary.search.targetProteins > 0) {
    out.push({ id: 'no-decoys', message: 'The search reports no decoy proteins, so its FDR rests on no decoys. Check the decoy setting and the decoy marker of the database.' })
  } else if (summary.psmFdr > 0 && summary.search.decoyProteins > 0 && summary.search.targetProteins > 0) {
    const ratio = summary.search.decoyProteins / summary.search.targetProteins
    if (ratio < DECOY_RATIO.min || ratio > DECOY_RATIO.max) {
      const n = (x: number) => x.toLocaleString('en-US')
      out.push({
        id: 'decoy-ratio',
        message: `The search had ${n(summary.search.decoyProteins)} decoy proteins for ${n(summary.search.targetProteins)} targets. A target-decoy FDR needs about one decoy per target, so this one is not what it says: search again with the decoys set to Generate.`,
      })
    }
  }
  const ps = m.tables.psms
  const qs = new Map<number, { n: number; nonzero: number }>()
  for (let i = 0; i < ps.count; i++) {
    if (!Number.isFinite(ps.qValue[i])) continue
    const e = qs.get(ps.file[i]) ?? { n: 0, nonzero: 0 }
    e.n++
    if (ps.qValue[i] > 0) e.nonzero++
    qs.set(ps.file[i], e)
  }
  for (const [file, e] of qs) {
    if (e.n >= ALL_Q_ZERO_MIN_PSMS && e.nonzero === 0) {
      out.push({
        id: 'all-q-zero',
        message: `${baseName(m.tables.files[file])}: all ${e.n} PSMs have q-value 0. Without rescoring a short list can give this (no decoy scores among its best PSMs); otherwise the decoys were probably not recognised. Check the rescoring and the decoys before you trust the FDR.`,
      })
    }
  }
  // isotope peaks and retention times of the passing PSMs
  const rows = levelRows(m, 'psms', false)
  let isotope = 0
  const maxRt = new Array<number>(m.tables.files.length).fill(-Infinity)
  for (const i of rows) {
    if (ps.isotopeError[i] !== 0) isotope++
    if (ps.rt[i] > maxRt[ps.file[i]]) maxRt[ps.file[i]] = ps.rt[i]
  }
  if (rows.length >= ISOTOPE_MIN_PSMS && isotope / rows.length > ISOTOPE_SHARE) {
    out.push({
      id: 'isotope-share',
      message: `${((isotope / rows.length) * 100).toFixed(0)} % of the passing PSMs match an isotope peak, not the monoisotopic one: the precursor m/z of the spectra is often off by one isotope. Check the conversion (monoisotopic peak correction) or the instrument's precursor picking.`,
    })
  }
  summary.files.forEach((f, k) => {
    const rt = maxRt[k]
    if (!Number.isFinite(rt)) return
    if (rt > RT_MAX_S || (rt < RT_MIN_S && f.ms2Spectra >= RT_MIN_SPECTRA)) {
      out.push({
        id: 'rt-unit',
        message: `${baseName(f.path)}: the identifications end at a retention time of ${rt.toFixed(1)} s (${(rt / 60).toFixed(1)} min), which fits no LC run of ${f.ms2Spectra} MS2 spectra. The file's retention times may be in the wrong unit.`,
      })
    }
  })
  // the settings: what ProSE recorded against what was asked
  for (const e of parameterEcho(s.parameters, s.provenance)) {
    if (!e.same) out.push({ id: 'parameter-echo', message: `ProSE used ${e.name} = ${e.used}, not ${e.asked} as set.` })
  }
  return out
}

export type EchoRow = { name: string; asked: string; used: string; same: boolean }

const show = (v: unknown) => (Array.isArray(v) ? (v.length ? v.join(', ') : 'none') : String(v))

/** What ProSE recorded of the settings in its provenance, beside what was set (the parameters on ProSE's defaults). */
export function parameterEcho(parameters: Record<string, unknown>, provenance: Record<string, string> | undefined): EchoRow[] {
  if (!provenance) return []
  const asked = { ...defaultsOf(PROSE_PARAMETERS), ...parameters }
  const used = qpxParameters(new Map(Object.entries(provenance)))
  return Object.entries(used)
    .filter(([name]) => name in asked)
    .map(([name, value]) => {
      const want = asked[name]
      const same = Array.isArray(value) ? sameValue([...value].sort(), [...((want as unknown[]) ?? [])].map(String).sort()) : String(value) === String(want)
      return { name, asked: show(want), used: show(value), same }
    })
}
