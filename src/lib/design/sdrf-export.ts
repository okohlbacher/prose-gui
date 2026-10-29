// "Export SDRF" of a finished search: the SDRF it was started with (or one made from its design table), with
// the technical columns the search knows filled in: data file, fraction, technical replicate, label, technology
// type, cleavage agent, modifications, tolerances, SDRF version and annotation tool. A value the SDRF has is
// never overwritten: only empty cells and missing columns are filled.

import unimod from '../chemistry/unimod.json'
import type { DesignResolution } from './model'
import {
  addColumn,
  cell,
  column,
  columns,
  dataRows,
  parseSdrfTable,
  setCell,
  writeSdrfTable,
  type SdrfTable,
} from './sdrf-table'

/** PSI-MS accessions of OpenMS' enzymes (the cleavage agent's AC); others are written by name only. */
const ENZYMES: Record<string, string> = {
  Trypsin: 'MS:1001251',
  'Trypsin/P': 'MS:1001313',
  'Arg-C': 'MS:1001303',
  'Asp-N': 'MS:1001304',
  Chymotrypsin: 'MS:1001306',
  'Lys-C': 'MS:1001309',
  'Lys-C/P': 'MS:1001310',
  PepsinA: 'MS:1001311',
  'glutamyl endopeptidase': 'MS:1001917',
  'unspecific cleavage': 'MS:1001956',
  'no cleavage': 'MS:1001955',
}

const UNIMOD_ID = new Map(Object.entries(unimod as unknown as Record<string, [string, number]>).map(([id, [name]]) => [name, id]))

/** The cleavage agent of OpenMS' enzyme name: "NT=Trypsin;AC=MS:1001251". */
export function cleavageAgent(enzyme: string): string {
  const ac = ENZYMES[enzyme]
  return ac ? `NT=${enzyme};AC=${ac}` : `NT=${enzyme}`
}

/**
 * An OpenMS modification ("Oxidation (M)", "Acetyl (Protein N-term)", "Gln->pyro-Glu (N-term Q)") in SDRF's
 * key=value form: "NT=Oxidation;AC=UNIMOD:35;TA=M;MT=Variable", with PP for a terminus.
 */
export function modificationParameter(mod: string, type: 'Fixed' | 'Variable'): string {
  const m = /^(.*?)\s*\(([^()]*)\)$/.exec(mod.trim())
  const name = m ? m[1] : mod.trim()
  const site = m ? m[2] : ''
  const parts = [`NT=${name}`]
  const id = UNIMOD_ID.get(name)
  if (id) parts.push(`AC=UNIMOD:${id}`)
  const term = /^(Protein )?([NC])-term\s*(.*)$/.exec(site)
  if (term) {
    parts.push(`PP=${term[1] ? 'Protein' : 'Any'} ${term[2]}-term`)
    if (term[3]) parts.push(`TA=${term[3].split('').join(',')}`)
  } else if (site) {
    parts.push(`TA=${site.split('').join(',')}`)
  }
  parts.push(`MT=${type}`)
  return parts.join(';')
}

/** The sample columns every SDRF needs, which the design table does not know: "not available" until filled in. */
export const SAMPLE_COLUMNS = [
  'characteristics[organism]',
  'characteristics[organism part]',
  'characteristics[disease]',
  'characteristics[cell type]',
]

/** An SDRF of the design table, for a search started without one. */
export function sdrfFromDesign(design: DesignResolution): SdrfTable {
  const headers = [
    'source name',
    ...SAMPLE_COLUMNS,
    'characteristics[biological replicate]',
    'assay name',
    'comment[data file]',
    'comment[fraction identifier]',
    'comment[technical replicate]',
    'factor value[condition]',
  ]
  const rows = design.rows.map((r, i) => [
    design.samples[r.sample]?.label ?? `sample ${r.sample + 1}`,
    ...SAMPLE_COLUMNS.map(() => 'not available'),
    String(r.replicate),
    `run ${i + 1}`,
    r.fileName,
    String(r.fraction),
    String(r.techReplicate),
    r.condition ?? 'not available',
  ])
  return { headers, rows, bom: false, eol: '\n', trailingEol: true }
}

export type ExportSettings = {
  /** ProSE's parameters: its defaults with the search's own on top. */
  values: Record<string, unknown>
  appVersion: string
}

/** The SDRF of a finished search (`sdrf`: the one it was started with, as text). */
export function exportSdrf(sdrf: string | null, design: DesignResolution, s: ExportSettings): string {
  const t = sdrf ? parseSdrfTable(sdrf) : sdrfFromDesign(design)
  const rows = dataRows(t)
  const fileCol = column(t, 'comment[data file]')
  const designOf = (r: number) => {
    const name = cell(t, r, fileCol)
    return design.rows.find((d) => d.fileName === name)
  }

  /** Fills the empty cells of the column `name` (added where it is missing); `value` '' leaves a cell. */
  const fill = (name: string, value: (r: number) => string, col = column(t, name)) => {
    if (col < 0) col = addColumn(t, name)
    for (const r of rows) if (cell(t, r, col) === '') setCell(t, r, col, value(r))
  }

  const v = s.values
  fill('comment[fraction identifier]', (r) => String(designOf(r)?.fraction ?? 1))
  fill('comment[technical replicate]', (r) => String(designOf(r)?.techReplicate ?? 1))
  fill('comment[label]', () => 'label free sample')
  fill('technology type', () => 'proteomic profiling by mass spectrometry')
  fill('comment[instrument]', () => 'not available')
  fill('comment[cleavage agent details]', () => cleavageAgent(String(v['enzyme'] ?? 'Trypsin')))

  const mods = [
    ...((v['modifications:fixed'] as string[] | undefined) ?? []).map((m) => modificationParameter(m, 'Fixed')),
    ...((v['modifications:variable'] as string[] | undefined) ?? []).map((m) => modificationParameter(m, 'Variable')),
  ]
  // ponytail: by position; an SDRF that lists its own modifications keeps them, cell by cell
  const modCols = columns(t, 'comment[modification parameters]')
  mods.forEach((mod, k) => fill('comment[modification parameters]', () => mod, modCols[k] ?? -1))

  const lower = Math.abs(Number(v['precursor:mass_tolerance_lower'] ?? 0))
  const upper = Math.abs(Number(v['precursor:mass_tolerance_upper'] ?? 0))
  // (an asymmetric window is written as its larger side)
  fill('comment[precursor mass tolerance]', () => `${Math.max(lower, upper)} ${v['precursor:mass_tolerance_unit'] ?? 'ppm'}`)
  fill('comment[fragment mass tolerance]', () => `${v['fragment:mass_tolerance']} ${v['fragment:mass_tolerance_unit'] ?? 'Da'}`)
  fill('comment[sdrf version]', () => 'v1.1.0')
  fill('comment[sdrf annotation tool]', () => `prose-gui ${s.appVersion}`)
  return writeSdrfTable(t)
}
