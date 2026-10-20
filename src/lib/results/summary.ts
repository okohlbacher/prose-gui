// ProSE's end-of-search report (summary.yaml) and the open search's modification analysis
// (mods/*_ModificationAnalysis_{DeltaMassStats,PTMStats}.tsv) as the web app's ProSEMultiSummary
// (docs/parity.md, "ProSEMultiSummary").

import { load } from 'js-yaml'
import type { ProSEFileSummary, ProSEMultiSummary, ProSESummary } from './types'

type Yaml = Record<string, any>

/** ProSE's exit codes (TOPPBase::ExitCodes) as the web app's status. */
const STATUS: Record<number, ProSEFileSummary['status']> = {
  0: 'EXECUTION_OK',
  1: 'INPUT_FILE_EMPTY',
  2: 'UNEXPECTED_RESULT',
  3: 'UNKNOWN_ERROR',
  4: 'ILLEGAL_PARAMETERS',
}

export function parseSummaryYaml(text: string): Yaml {
  const yaml = load(text)
  if (yaml === null || typeof yaml !== 'object' || !('per_file' in yaml)) throw new Error('summary.yaml has no per_file')
  return yaml as Yaml
}

const number = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback)
const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/** A mass error estimate; `valid: false` → null. */
function massError(e: Yaml | undefined): ProSESummary['run']['precursorError'] {
  if (!e || e.valid !== true) return null
  return { median: number(e.median_ppm), mad: number(e.mad_ppm), recommended: number(e.recommended_ppm) }
}

/**
 * Percolator's outcome for a file: null when the search did not rescore (`applied: false` without a
 * reason; the web app has null for a search with `rescore: false`), else applied, skipped and warning.
 */
function percolator(p: Yaml | undefined): ProSEFileSummary['percolator'] {
  if (!p) return null
  const applied = p.applied === true
  const skipped = text(p.skipped_reason)
  if (!applied && skipped === null) return null
  return { applied, skipped, warning: text(p.warning) }
}

/**
 * The summary of the search: `paths` are the app's inputs (in order; summary.yaml has their names in the
 * search folder), `decoyString` the search's decoy marker (OMS search params), `modificationAnalysis`
 * the parsed TSVs (null: closed search).
 */
export function toSummary(
  yaml: Yaml,
  paths: string[],
  decoyString: string,
  modificationAnalysis: ProSESummary['modificationAnalysis'],
): ProSEMultiSummary {
  const shared: Yaml = yaml.shared ?? {}
  const perFile: Yaml[] = yaml.per_file ?? []
  const files: ProSEFileSummary[] = perFile.map((f, i) => ({
    path: paths[i] ?? String(f.input_file ?? ''),
    status: STATUS[number(f.exit_code, 3)] ?? 'UNKNOWN_ERROR',
    ms2Spectra: number(f.ms2_spectra),
    targetPSMs: number(f.target_psms),
    decoyPSMs: number(f.decoy_psms),
    percolator: percolator(f.percolator),
    peptdeepNce: typeof f.peptdeep_nce === 'number' ? f.peptdeep_nce : null,
    precursorError: massError(f.precursor_error),
    fragmentError: massError(f.fragment_error),
    secondsSearch: number(f.timing_seconds?.search),
  }))
  return {
    files,
    search: {
      databaseFile: String(shared.database_file ?? ''),
      enzyme: String(shared.enzyme ?? ''),
      openSearch: shared.open_search === true,
      calibration: shared.calibration_enabled === true,
      chunked: shared.chunked === true,
      decoyMode: String(shared.decoy_mode ?? ''),
      targetProteins: number(shared.db_target_proteins),
      decoyProteins: number(shared.db_decoy_proteins),
      indexedPeptides: number(shared.indexed_peptides),
      indexedFragments: number(shared.indexed_fragments),
      secondsIndexBuild: number(shared.seconds_index_build),
      secondsTotal: number(shared.seconds_total),
    },
    proteinFdrApplied: yaml.protein_fdr_applied === true,
    psmFdr: number(shared.psm_fdr_threshold),
    proteinFdr: number(shared.protein_fdr_threshold),
    decoyString,
    openSearch: shared.open_search === true,
    modificationAnalysis,
  }
}

//------------------------------------------------------------------------------
// The modification analysis

/** The header values ('# Total PSMs: 3') and the rows of a ModificationAnalysis TSV. */
function parseTsv(tsv: string): { header: Map<string, string>; rows: Record<string, string>[] } {
  const header = new Map<string, string>()
  const lines = tsv.split(/\r?\n/)
  let i = 0
  for (; i < lines.length && lines[i].startsWith('#'); i++) {
    const m = /^#\s*([^:]+):\s*(.*)$/.exec(lines[i])
    if (m) header.set(m[1].trim(), m[2].trim())
  }
  const columns = (lines[i] ?? '').split('\t')
  const rows = lines
    .slice(i + 1)
    .filter((l) => l.trim() !== '')
    .map((l) => {
      const cells = l.split('\t')
      return Object.fromEntries(columns.map((c, j) => [c, cells[j] ?? '']))
    })
  return { header, rows }
}

const toNumber = (s: string | undefined) => (s === undefined || s === '' ? NaN : Number(s))

/** 'A:4,D:2' → { A: 4, D: 2 } */
function residueCounts(s: string | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  for (const pair of (s ?? '').split(',')) {
    const [residue, count] = pair.split(':')
    if (residue && count !== undefined) out[residue.trim()] = Number(count)
  }
  return out
}

/**
 * The modification analysis of the TSVs (six significant digits). The PTM table has no charge states:
 * chargeStates is 0 (the web app's screens do not show it).
 */
export function parseModificationAnalysis(deltaMassStats: string, ptmStats: string): NonNullable<ProSESummary['modificationAnalysis']> {
  const d = parseTsv(deltaMassStats)
  const p = parseTsv(ptmStats)
  return {
    deltaMasses: {
      totalPSMs: toNumber(d.header.get('Total PSMs')),
      modifiedPSMs: toNumber(d.header.get('Modified PSMs')),
      unmodifiedPSMs: toNumber(d.header.get('Unmodified PSMs')),
      meanDeltaMass: toNumber(d.header.get('Mean Delta Mass')),
      medianDeltaMass: toNumber(d.header.get('Median Delta Mass')),
      entries: d.rows.map((r) => ({
        deltaMass: toNumber(r.DeltaMass),
        count: toNumber(r.Count),
        uniquePeptides: toNumber(r.UniquePeptides),
        chargeStates: toNumber(r.ChargeStates),
        percentage: toNumber(r.Percentage),
        modification: r.MappedModification ?? '',
        known: r.IsKnown === 'true',
      })),
    },
    ptms: {
      totalModifiedPSMs: toNumber(p.header.get('Total Modified PSMs')),
      unknownModificationPSMs: toNumber(p.header.get('Unknown Modification PSMs')),
      uniqueModifications: toNumber(p.header.get('Unique Modifications')),
      entries: p.rows.map((r) => ({
        name: r.Name ?? '',
        theoreticalMass: toNumber(r.TheoreticalMass),
        observedMass: toNumber(r.ObservedMass),
        massDeviation: toNumber(r.MassDeviation),
        count: toNumber(r.Count),
        uniquePeptides: toNumber(r.UniquePeptides),
        chargeStates: 0,
        percentage: toNumber(r.Percentage),
        targetResidues: r.TargetResidues ?? '',
        residueCounts: residueCounts(r.ResidueFrequency),
      })),
    },
  }
}
