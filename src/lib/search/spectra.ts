// The Spectra status of the design table (guidance G1, interim): what the first MS2 spectra of each mzML say by
// their flags (`SpectraFacts`), as one line for the batch and a mark on the files that differ from it, and the
// red flags it raises (`checks.ts`). By the flags only: "centroid" means "flagged centroid, not verified".

import type { SpectraFacts } from '../desktop'
import { SPECTRA_SHARE } from '../results/diagnosis'
import type { Check } from './checks'

/**
 * DIA is suspected when the MS2 spectra read have at most this many distinct isolation centres per spectrum: DDA
 * picks a new precursor almost every time, DIA cycles through a fixed set of windows. PRM repeats too and is fine
 * to search, so this is a red flag the user can override (paper review: centres per MS2, not the window width, which misreads wide-window
 * DDA and misses narrow-window DIA).
 */
export const DIA_CENTRES_PER_MS2 = 0.25
/** At least this many MS2 spectra are needed to judge the isolation pattern. */
export const DIA_MIN_MS2 = 50
/**
 * DIA is suspected as well when at least this share of the MS2 spectra read have an isolation target that recurs
 * (3 times or more among up to 1,000 spectra): DIA cycles through its windows, however many (60 variable windows,
 * 300 narrow Astral windows), while DDA rarely isolates the very same m/z again.
 */
export const DIA_REPEATED_SHARE = 0.5
/** Or when the isolation windows are this wide (m/z) and most spectra have no precursor charge: wide-window DIA. */
export const DIA_WIDE_WINDOW = 4
/** MS2 spectra with a precursor charge below this share: charges were not recorded (timsTOF mzML converted the
 * wrong way, older ion-trap data); ProSE then tries every charge of the range, which costs time and FDR. */
export const CHARGE_SHARE = 0.5

const ms2Of = (f: SpectraFacts) => f.levels['2'] ?? 0

/** The files New search looks into: mzML (also gzipped); ProSE reads mzPeak, .raw and .d itself. */
export const inspectable = (name: string) => /\.mzml(\.gz)?$/i.test(name)

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
  // a smaller share is no red flag, but the diagnosis names it after the search from the same share on: said before too
  const some = pick((f) => ms2Of(f) > 0 && f.ms2Profile > SPECTRA_SHARE * ms2Of(f) && f.ms2Profile <= ms2Of(f) / 2)
  if (some.length > 0) {
    out.push({
      id: 'profile-ms2-share',
      level: 'warn',
      source: 'spectra',
      files: some.map((r) => r.path),
      message:
        `${named(some)}: ${some.length === 1 ? `${Math.round((100 * some[0].facts!.ms2Profile) / ms2Of(some[0].facts!))} % of the MS2 spectra read are` : 'some of the MS2 spectra read are'} flagged as profile. ` +
        'ProSE identifies few peptides from profile spectra: centroid the file (msconvert --filter "peakPicking vendor msLevel=1-") if it is not meant to be mixed.',
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
  const dia = pick((f) => {
    const n = ms2Of(f)
    if (n < DIA_MIN_MS2) return false
    const fewCentres = f.isolationCentres <= DIA_CENTRES_PER_MS2 * n || f.ms2WithPrecursor === 0
    const repeated = (f.ms2RepeatedTarget ?? 0) >= DIA_REPEATED_SHARE * n
    const wide = (f.isolationWidth ?? 0) >= DIA_WIDE_WINDOW && f.ms2WithCharge < CHARGE_SHARE * n
    return fewCentres || repeated || wide
  })
  if (dia.length > 0) {
    out.push({
      id: 'dia-suspected',
      level: 'block',
      overridable: true,
      source: 'spectra',
      files: dia.map((r) => r.path),
      message:
        `${named(dia)}: the MS2 spectra cycle through the same isolation windows, as DIA does. ProSE searches DDA spectra one precursor at a time, ` +
        'so DIA data identify few peptides here: search them with a DIA search engine. Targeted data (PRM) repeat their windows too and can be searched anyway.',
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
  // (null: not inspected; undefined: still being inspected, which holds Start in `startChecks`)
  const unchecked = rows.filter((r) => r.facts === null)
  const vendor = unchecked.filter((r) => !inspectable(r.name))
  const failed = unchecked.filter((r) => inspectable(r.name))
  const notChecked = 'profile spectra, missing MS2 spectra and DIA are not checked before the search; the Overview of the result reports profile spectra, missing MS2 spectra and charges outside the range, but not DIA.'
  if (vendor.length > 0) {
    out.push({
      id: 'spectra-not-checked',
      level: 'info',
      source: 'spectra',
      files: vendor.map((r) => r.path),
      message: `${named(vendor)}: ProSE reads ${vendor.length === 1 ? 'this format' : 'these formats'} (mzPeak, Thermo .raw, Bruker .d) itself, but New search does not look into ${vendor.length === 1 ? 'it' : 'them'}, so ${notChecked}`,
    })
  }
  if (failed.length > 0) {
    out.push({
      id: 'spectra-not-read',
      level: 'warn',
      source: 'spectra',
      files: failed.map((r) => r.path),
      message: `${named(failed)}: the spectra could not be read for the checks, so ${notChecked}`,
    })
  }
  return out
}
