// The scope line under the design table (guidance G7): what the FDR of the search is computed over, so that the
// numbers are read at the right level. ProSE estimates the PSM FDR per input file, within the groups of
// FDR:PSM_groups ('scored_charges' by default: separately for PSMs scored with different numbers of fragment
// charges), and the protein FDR once over all files (ProSE.cpp, the code review of the guidance features).

import type { DesignResolution } from '../design/model'

/** "4 files, 1 search: PSM FDR per file and per fragment-charge group (FDR:PSM_groups), protein FDR across all files" */
export function scopeLine(files: number, values: Record<string, unknown>, fdrBlocked: boolean): string {
  const head = `${files} ${files === 1 ? 'file' : 'files'}, 1 search`
  if (fdrBlocked) return `${head}: no FDR (no decoys)`
  const groups = values['FDR:PSM_groups']
  const psm =
    groups === 'pooled'
      ? 'PSM FDR per file, all PSMs pooled (FDR:PSM_groups)'
      : 'PSM FDR per file and per fragment-charge group (FDR:PSM_groups)'
  const protein = Number(values['FDR:protein']) > 0 ? (files > 1 ? 'protein FDR across all files' : 'protein FDR of the file') : 'no protein FDR'
  return `${head}: ${psm}, ${protein}`
}

/** The id of the fractions note (`settings/faq.ts` links it to Help). */
export const FRACTIONS_NOTE_ID = 'fractions-no-replicates'

/**
 * Fractions without biological replicates: every condition has one replicate, measured in fractions. Searchable,
 * but no comparison between conditions has a replicate to rest on (paper, issue 9).
 */
export function fractionsWithoutReplicates(design: DesignResolution): string | null {
  if (!design.rows.some((r) => r.fraction > 1) || design.conditions.length === 0) return null
  const replicates = new Map<string, Set<number>>()
  for (const s of design.samples) if (s.condition !== null) replicates.set(s.condition, (replicates.get(s.condition) ?? new Set()).add(s.replicate))
  if ([...replicates.values()].some((r) => r.size > 1)) return null
  return 'The files are fractions of one replicate per condition: the search works, but a comparison of the conditions has no replicates to rest on.'
}
