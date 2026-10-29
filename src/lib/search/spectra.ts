// The Spectra status of the design table (guidance G1, interim): what the first MS2 spectra of each mzML say by
// their flags (`SpectraFacts`), as one line for the batch and a mark on the files that differ from it, and the
// red flags it raises (`checks.ts`). By the flags only: "centroid" means "flagged centroid, not verified".

import type { SpectraFacts } from '../desktop'
import type { Check } from './checks'

/**
 * DIA is suspected when the MS2 spectra read have at most this many distinct isolation centres per spectrum: DDA
 * picks a new precursor almost every time, DIA cycles through a fixed set of windows. PRM repeats too and is fine
 * to search, so this only warns (paper review: centres per MS2, not the window width, which misreads wide-window
 * DDA and misses narrow-window DIA).
 */
export const DIA_CENTRES_PER_MS2 = 0.25
/** At least this many MS2 spectra are needed to judge the isolation pattern. */
export const DIA_MIN_MS2 = 50
/** MS2 spectra with a precursor charge below this share: charges were not recorded (timsTOF mzML converted the
 * wrong way, older ion-trap data); ProSE then tries every charge of the range, which costs time and FDR. */
export const CHARGE_SHARE = 0.5

const ms2Of = (f: SpectraFacts) => f.levels['2'] ?? 0

/** The most frequent key of a count map, or null. */
function top(counts: Record<string, number>): string | null {
  let best: string | null = null
  for (const [k, n] of Object.entries(counts)) if (best === null || n > counts[best]) best = k
  return best
}

/** The MS2 analyzer: the filter strings', else the header's only analyzer (null: not known). */
export function ms2Analyzer(f: SpectraFacts): string | null {
  return top(f.ms2Analyzer) ?? (f.analyzers.length === 1 ? f.analyzers[0] : null)
}

/** The short status of one file: "centroid · CID · ion trap", "profile", "no MS2". */
export function spectraLabel(f: SpectraFacts): string {
  const n = ms2Of(f)
  if (n === 0) return f.complete ? 'no MS2' : 'no MS2 near the start'
  const parts = [f.ms2Profile > n / 2 ? 'profile' : f.ms2Centroid > n / 2 ? 'centroid' : 'mode not flagged']
  const act = top(f.activation)
  if (act) parts.push(activationShort(act))
  const analyzer = ms2Analyzer(f)
  if (analyzer) parts.push(analyzer)
  return parts.join(' · ')
}

function activationShort(name: string): string {
  const known: Record<string, string> = {
    'beam-type collision-induced dissociation': 'HCD',
    'collision-induced dissociation': 'CID',
    'electron transfer dissociation': 'ETD',
    'higher energy beam-type collision-induced dissociation': 'HCD',
    'supplemental beam-type collision-induced dissociation': 'EThcD',
    'electron capture dissociation': 'ECD',
  }
  return known[name] ?? name
}

/** The batch line and the files that differ from it (by path). */
export function batchStatus(rows: { path: string; facts: SpectraFacts | null | undefined }[]): { line: string; differ: Map<string, string> } | null {
  const known = rows.filter((r): r is { path: string; facts: SpectraFacts } => !!r.facts)
  if (known.length === 0) return null
  const labels = known.map((r) => spectraLabel(r.facts))
  const counts: Record<string, number> = {}
  for (const l of labels) counts[l] = (counts[l] ?? 0) + 1
  const line = top(counts)!
  const differ = new Map<string, string>()
  known.forEach((r, k) => labels[k] !== line && differ.set(r.path, labels[k]))
  return { line, differ }
}

/** The red flags and advice of the files' spectra (`checks.ts`): profile MS2, no MS2, DIA suspected, no charges. */
export function spectraChecks(rows: { path: string; name: string; facts: SpectraFacts | null | undefined }[]): Check[] {
  const out: Check[] = []
  const pick = (test: (f: SpectraFacts) => boolean) => rows.filter((r) => r.facts && test(r.facts))
  const named = (list: { name: string }[]) => (list.length === 1 ? list[0].name : `${list.length} files`)
  const profile = pick((f) => ms2Of(f) > 0 && f.ms2Profile > ms2Of(f) / 2)
  if (profile.length > 0) {
    out.push({
      id: 'profile-ms2',
      level: 'block',
      overridable: true,
      source: 'spectra',
      files: profile.map((r) => r.path),
      message:
        `${named(profile)}: the MS2 spectra are flagged as profile. ProSE expects centroided spectra and would search them as they are, ` +
        'which identifies few peptides: centroid them first (msconvert --filter "peakPicking vendor msLevel=1-", or OpenMS PeakPickerHiRes).',
    })
  }
  const none = pick((f) => f.complete && ms2Of(f) === 0)
  if (none.length > 0) {
    out.push({
      id: 'no-ms2',
      level: 'block',
      overridable: true,
      source: 'spectra',
      files: none.map((r) => r.path),
      message: `${named(none)} ${none.length === 1 ? 'has' : 'have'} no MS2 spectra (MS1 only?): nothing in ${none.length === 1 ? 'it' : 'them'} can be searched.`,
    })
  }
  const dia = pick((f) => ms2Of(f) >= DIA_MIN_MS2 && (f.isolationCentres <= DIA_CENTRES_PER_MS2 * ms2Of(f) || f.ms2WithPrecursor === 0))
  if (dia.length > 0) {
    out.push({
      id: 'dia-suspected',
      level: 'warn',
      source: 'spectra',
      files: dia.map((r) => r.path),
      message:
        `${named(dia)}: the MS2 spectra repeat a few isolation windows, as DIA does (or PRM). ProSE searches DDA spectra one precursor at a time; ` +
        'DIA data need a DIA search engine.',
    })
  }
  const charge = pick((f) => ms2Of(f) > 0 && f.ms2WithCharge < CHARGE_SHARE * ms2Of(f))
  if (charge.length > 0) {
    out.push({
      id: 'no-charge',
      level: 'info',
      source: 'spectra',
      files: charge.map((r) => r.path),
      message: `${named(charge)}: most MS2 spectra have no precursor charge, so ProSE tries every charge of the range. A timsTOF file converted without its PASEF precursors looks like this.`,
    })
  }
  return out
}
