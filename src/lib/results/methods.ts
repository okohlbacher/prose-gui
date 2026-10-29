// The methods paragraph of the Overview (survey P0-8): the search as a methods section would describe
// it, from the summary and the settings only (no local paths). It never claims an FDR that was not
// estimated: no protein-level FDR, no peptide-level FDR.

import { formatPercent } from '$lib/format/fdr'
import { baseName } from './model'
import type { ProSEMultiSummary } from './types'

export type MethodsInput = {
  summary: ProSEMultiSummary
  settings: { database: string; contaminants: boolean; fixedMods: string[]; parameters: Record<string, unknown>; rescore: boolean; peptdeep: boolean }
  version: string
}

const count = (n: number) => n.toLocaleString('en')

export function methodsText({ summary: s, settings, version }: MethodsInput): string {
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
  if (settings.rescore) parts.push(`PSMs were rescored with Percolator${settings.peptdeep ? ', with PeptDeep fragment-intensity and retention-time predictions as features' : ''}.`)
  if (s.psmFdr === 0) parts.push('The database had no decoys, so no FDR was estimated; the PSMs are not FDR-controlled.')
  else parts.push(`PSMs were filtered at ${formatPercent(s.psmFdr)} PSM-level FDR (target-decoy). No peptide-level FDR was estimated.`)
  parts.push(
    s.proteinFdrApplied
      ? `Protein groups were filtered at ${formatPercent(s.proteinFdr)} protein-level FDR.`
      : 'No protein-level FDR was applied; the protein groups reported are not FDR-controlled.',
  )
  return parts.join(' ')
}
