// The methods paragraph of the Overview (survey P0-8): the search as a methods section would describe
// it, from the summary and the settings only (no local paths). It never claims an FDR that was not
// estimated: no protein-level FDR, no peptide-level FDR.

import { formatPercent } from '$lib/format/fdr'
import { baseName } from './model'
import { psmFdrSkipped } from './overview'
import type { ProSEMultiSummary } from './types'
import type { AcceptedCheck } from '../search/checks'

export type MethodsInput = {
  summary: ProSEMultiSummary
  settings: { database: string; contaminants: boolean; fixedMods: string[]; parameters: Record<string, unknown>; rescore: boolean; peptdeep: boolean }
  version: string
  /** The red flags New search was overridden for (`OpenResult.accepted`). */
  accepted?: AcceptedCheck[]
}

/**
 * The red flags the methods text names when the search confirmed them (ProSE reports the same about the files):
 * a flag the search did not confirm was a false alarm and is left out (guidance G10).
 */
const CONFIRMED: Record<string, { held: (s: ProSEMultiSummary) => boolean; text: string }> = {
  'profile-ms2': {
    held: (s) => s.files.some((f) => (f.profileSpectra ?? 0) > 0),
    text: 'Some MS2 spectra were recorded in profile mode and were searched as they are, without centroiding.',
  },
  'no-ms2': {
    held: (s) => s.files.some((f) => f.ms2Spectra === 0),
    text: 'Some input files had no MS2 spectra.',
  },
}

const count = (n: number) => n.toLocaleString('en')

export function methodsText({ summary: s, settings, version, accepted = [] }: MethodsInput): string {
  const files = s.files.length
  const db = baseName(settings.database)
  const parts: string[] = []
  const dbFacts = [
    s.search.targetProteins > 0 ? `${count(s.search.targetProteins)} target entries` : '',
    settings.contaminants ? 'with common contaminants' : '',
    s.search.decoyProteins > 0 ? `${count(s.search.decoyProteins)} decoys${s.search.decoyMode ? ` (${s.search.decoyMode})` : ''}` : '',
  ].filter(Boolean)
  parts.push(
    `${files} ${files === 1 ? 'file was' : 'files were'} searched with ProSE${version ? ` ${version}` : ''} (OpenMS) against ${db}` +
      (dbFacts.length ? ` (${dbFacts.join(', ')})` : '') +
      '.',
  )
  const digest = [s.search.enzyme ? `Enzyme: ${s.search.enzyme}.` : '', settings.fixedMods.length ? `Fixed modifications: ${settings.fixedMods.join(', ')}.` : '']
  parts.push(...digest.filter(Boolean))
  if (s.openSearch) parts.push('The search was an open search (wide precursor window); mass shifts are reported unlocalized.')
  const changed = Object.entries(settings.parameters).filter(([k]) => !/file|path/i.test(k))
  if (changed.length) parts.push(`Parameters changed from the ProSE defaults: ${changed.map(([k, v]) => `${k} = ${String(v)}`).join('; ')}.`)
  // (what ProSE did, not what was asked: Percolator and the PSM FDR can be skipped per file)
  const rescored = s.files.filter((f) => f.percolator?.applied).length
  if (rescored > 0) {
    const which = rescored < files ? ` (${rescored} of ${files} files; Percolator was skipped for the others)` : ''
    parts.push(`PSMs were rescored with Percolator${settings.peptdeep ? ', with PeptDeep fragment-intensity and retention-time predictions as features' : ''}${which}.`)
  }
  const skipped = s.psmFdr === 0 ? [] : psmFdrSkipped(s)
  if (s.psmFdr === 0) parts.push('The database had no decoys, so no FDR was estimated; the PSMs are not FDR-controlled.')
  else if (skipped.length === files) parts.push('ProSE reported the PSM FDR as not applied, so the PSMs are not FDR-controlled.')
  else {
    parts.push(`PSMs were filtered at ${formatPercent(s.psmFdr)} PSM-level FDR (target-decoy). No peptide-level FDR was estimated.`)
    if (skipped.length > 0) parts.push(`For ${skipped.length} of ${files} files ProSE reported the PSM FDR as not applied, so their PSMs are not FDR-controlled.`)
  }
  parts.push(
    s.proteinFdrApplied
      ? `Protein groups were filtered at ${formatPercent(s.proteinFdr)} protein-level FDR.`
      : 'No protein-level FDR was applied; the protein groups reported are not FDR-controlled.',
  )
  for (const id of new Set(accepted.map((a) => a.id))) if (CONFIRMED[id]?.held(s)) parts.push(CONFIRMED[id].text)
  return parts.join(' ')
}
