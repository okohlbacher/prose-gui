// Plausibility of the settings before Start (review measure 7): values ProSE accepts but that rarely fit the data,
// judged against what the files' first spectra say (`SpectraFacts`) where that matters. Advice only (`warn`):
// each can be right for an unusual experiment.

import type { SpectraFacts } from '../desktop'
import { ION_TRAP_MODELS, type Check } from './checks'
import { ms2Analyzer } from './spectra'

/** Variable modifications from this many on: the search space grows fast and the FDR suffers. */
export const MANY_VARIABLE_MODS = 4
/** A fragment tolerance above this many Da, or below this many ppm, matches noise or almost nothing. */
export const FRAGMENT_MAX_DA = 1
export const FRAGMENT_MIN_PPM = 1
/** A Da precursor window in this range on high-resolution MS1 looks like a ppm value in the wrong unit (an open
 * search uses hundreds of Da). */
export const PRECURSOR_DA_TYPO = { min: 2, max: 20 }
/** A Da precursor window from this size up is wider than high-resolution MS1 needs (below it: a narrow window). */
export const PRECURSOR_DA_WIDE = 0.1

/** Analyzers that record high-resolution spectra (PSI-MS names, filter-string names). */
const HIGH_RES = /orbitrap|astral|time-of-flight|fourier|cyclotron/i

export type PlausibilityInput = {
  values: Record<string, unknown>
  files: { path: string; name: string; instrument: string | null; facts: SpectraFacts | null | undefined }[]
  /** Sets a parameter (the fixes' buttons). */
  set: (name: string, value: unknown) => void
}

export function plausibilityChecks({ values, files, set }: PlausibilityInput): Check[] {
  const out: Check[] = []
  const warn = (id: string, message: string, paths?: string[], action?: Check['action']) =>
    out.push({ id, level: 'warn', source: 'settings', message, ...(paths ? { files: paths } : {}), ...(action ? { action } : {}) })
  const named = (list: { name: string }[]) => (list.length === 1 ? list[0].name : list.length === files.length ? 'All files' : `${list.length} files`)

  const variable = (values['modifications:variable'] as string[] | undefined) ?? []
  if (variable.length >= MANY_VARIABLE_MODS) {
    warn(
      'many-variable-mods',
      `${variable.length} variable modifications: each one multiplies the peptides ProSE scores, which takes longer and makes ` +
        'true matches harder to tell from random ones. Keep the ones your sample needs (often Oxidation (M) and an N-terminal one).',
    )
  }

  const frag = Number(values['fragment:mass_tolerance'])
  const fragUnit = String(values['fragment:mass_tolerance_unit'])
  if (fragUnit === 'Da' && frag > FRAGMENT_MAX_DA) {
    warn('fragment-tolerance-wide', `A fragment tolerance of ${frag} Da matches almost any peak: ion-trap fragments need about 0.5 Da, high-resolution ones about 20 ppm.`)
  }
  if (fragUnit === 'ppm' && frag < FRAGMENT_MIN_PPM) {
    warn('fragment-tolerance-narrow', `A fragment tolerance of ${frag} ppm is narrower than any instrument measures fragments: ProSE would match almost none. High-resolution fragments need about 20 ppm.`)
  }
  const highResMs2 = files.filter((f) => f.facts && HIGH_RES.test(ms2Analyzer(f.facts) ?? ''))
  if (fragUnit === 'Da' && frag <= FRAGMENT_MAX_DA && highResMs2.length > 0) {
    warn(
      'fragment-da-highres',
      `${named(highResMs2)}: the MS2 spectra are high resolution, but the fragment tolerance is ${frag} Da: ProSE would match noise peaks ` +
        'as well, which costs identifications. High-resolution fragments need about 20 ppm.',
      highResMs2.map((f) => f.path),
      {
        label: 'Use 20 ppm',
        run: () => {
          set('fragment:mass_tolerance', 20)
          set('fragment:mass_tolerance_unit', 'ppm')
        },
      },
    )
  }

  const lower = Number(values['precursor:mass_tolerance_lower'])
  const upper = Number(values['precursor:mass_tolerance_upper'])
  const precUnit = String(values['precursor:mass_tolerance_unit'])
  const widest = Math.max(lower, upper)
  // (a pure ion trap records MS1 in the trap too; a hybrid's MS1 is the high-resolution analyzer's)
  const trap = (f: PlausibilityInput['files'][number]) => ION_TRAP_MODELS.test(f.instrument ?? '')
  const highResMs1 = files.filter((f) => !trap(f) && f.facts && f.facts.analyzers.some((a) => HIGH_RES.test(a)))
  if (precUnit === 'Da' && highResMs1.length > 0) {
    if (widest >= PRECURSOR_DA_TYPO.min && widest <= PRECURSOR_DA_TYPO.max) {
      warn(
        'precursor-da-typo',
        `The precursor tolerance is ${widest} Da, on high-resolution MS1 (${named(highResMs1)}): did you mean ${widest} ppm? ` +
          `${widest} Da compares each spectrum with many more peptides and lets wrong ones through.`,
        highResMs1.map((f) => f.path),
        { label: `Use ${widest} ppm`, run: () => set('precursor:mass_tolerance_unit', 'ppm') },
      )
    } else if (widest >= PRECURSOR_DA_WIDE && widest < PRECURSOR_DA_TYPO.min) {
      warn(
        'precursor-da-wide',
        `The precursor tolerance is ${widest} Da, wider than high-resolution MS1 needs (${named(highResMs1)}): about 10–20 ppm ` +
          'identifies more peptides at the same FDR.',
        highResMs1.map((f) => f.path),
      )
    }
  }
  const pureTrap = files.filter(trap)
  if (precUnit === 'ppm' && pureTrap.length > 0) {
    warn(
      'iontrap-precursor-ppm',
      `${named(pureTrap)} ${pureTrap.length === 1 ? 'was' : 'were'} measured on an ion trap only, whose MS1 is low resolution too, but the ` +
        `precursor tolerance is ${widest} ppm: ProSE would miss most precursors. Use a window of about 1–2 Da.`,
      pureTrap.map((f) => f.path),
    )
  }
  return out
}
