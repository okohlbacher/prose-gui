// The statistics of a search: the footer of ProSE's QPX psm files ('prose_' keys of -qpx_extended, documented in
// the tool's documentation) and the open search's modification analysis
// (mods/*_ModificationAnalysis_{DeltaMassStats,PTMStats}.tsv) as the web app's ProSEMultiSummary
// (docs/parity.md, "ProSEMultiSummary").

import type { ProSEFileSummary, ProSEMultiSummary, ProSESummary } from './types'

/** The footer key-value metadata of a psm.parquet. */
export type Footer = Map<string, string>

/** One entry of the footer's 'prose_files' (JSON). */
type FileEntry = Record<string, any>

/** ProSE's exit codes (TOPPBase::ExitCodes) as the web app's status. */
const STATUS: Record<number, ProSEFileSummary['status']> = {
  0: 'EXECUTION_OK',
  1: 'INPUT_FILE_EMPTY',
  2: 'UNEXPECTED_RESULT',
  3: 'UNKNOWN_ERROR',
  4: 'ILLEGAL_PARAMETERS',
}

/** The footer's 'prose_files': one entry per input, in input order. Throws if it is missing or not JSON. */
export function filesOf(footer: Footer): FileEntry[] {
  const text = footer.get('prose_files')
  if (text === undefined) throw new Error('the footer has no prose_files')
  const files: unknown = JSON.parse(text)
  if (!Array.isArray(files)) throw new Error('prose_files is not a list')
  return files as FileEntry[]
}

const number = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback)
const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
/** A footer number; `fallback` if it is missing or not a number. */
export const footerNumber = (footer: Footer, key: string, fallback = 0): number => {
  const v = Number(footer.get(key) ?? NaN)
  return Number.isNaN(v) ? fallback : v
}
export const footerFlag = (footer: Footer, key: string): boolean => footer.get(key) === 'true'

/** A mass error estimate; null: none. */
function massError(e: FileEntry | null | undefined): ProSESummary['run']['precursorError'] {
  if (!e || typeof e !== 'object') return null
  return { median: number(e.median_ppm), mad: number(e.mad_ppm), recommended: number(e.recommended_ppm) }
}

/**
 * Percolator's outcome for a file: null when the search did not rescore (`applied: false` without a
 * reason; the web app has null for a search with `rescore: false`), else applied, skipped and warning.
 */
function percolator(p: FileEntry | undefined): ProSEFileSummary['percolator'] {
  if (!p) return null
  const applied = p.applied === true
  const skipped = text(p.skipped_reason)
  if (!applied && skipped === null) return null
  return { applied, skipped, warning: text(p.warning) }
}

/**
 * The summary of the search: `paths` are the app's inputs (in order; the footer has their names in the
 * search folder), `modificationAnalysis` the parsed TSVs (null: closed search).
 */
export function toSummary(footer: Footer, paths: string[], modificationAnalysis: ProSESummary['modificationAnalysis']): ProSEMultiSummary {
  const files: ProSEFileSummary[] = filesOf(footer).map((f, i) => ({
    path: paths[i] ?? String(f.input_file ?? ''),
    status: STATUS[number(f.exit_code, 3)] ?? 'UNKNOWN_ERROR',
    ms2Spectra: number(f.ms2_spectra),
    targetPSMs: number(f.target_psms),
    decoyPSMs: number(f.decoy_psms),
    percolator: percolator(f.percolator),
    peptdeepNce: typeof f.peptdeep_nce === 'number' ? f.peptdeep_nce : null,
    precursorError: massError(f.precursor_error),
    fragmentError: massError(f.fragment_error),
    secondsSearch: number(f.seconds_search),
  }))
  const openSearch = footerFlag(footer, 'prose_open_search')
  return {
    files,
    search: {
      databaseFile: footer.get('prose_database_file') ?? '',
      enzyme: footer.get('prose_enzyme') ?? '',
      openSearch,
      calibration: footerFlag(footer, 'prose_calibration'),
      chunked: footerFlag(footer, 'prose_chunked'),
      decoyMode: footer.get('prose_decoy_mode') ?? '',
      targetProteins: footerNumber(footer, 'prose_db_target_proteins'),
      decoyProteins: footerNumber(footer, 'prose_db_decoy_proteins'),
      indexedPeptides: footerNumber(footer, 'prose_indexed_peptides'),
      indexedFragments: footerNumber(footer, 'prose_indexed_fragments'),
      secondsIndexBuild: footerNumber(footer, 'prose_seconds_index_build'),
      secondsTotal: footerNumber(footer, 'prose_seconds_total'),
    },
    proteinFdrApplied: footerFlag(footer, 'prose_protein_fdr_applied'),
    psmFdr: footerNumber(footer, 'prose_psm_fdr'),
    proteinFdr: footerNumber(footer, 'prose_protein_fdr'),
    decoyString: footer.get('prose_decoy_string') ?? 'DECOY_',
    openSearch,
    modificationAnalysis,
  }
}

/** The target PSMs of a search by its footer (the sum of `prose_files[].target_psms`); 0 if it says none. */
export function targetPsmsOf(footer: Footer): number {
  return filesOf(footer).reduce((n: number, f) => {
    const psms = f?.target_psms
    return n + (typeof psms === 'number' && Number.isFinite(psms) ? psms : 0)
  }, 0)
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
