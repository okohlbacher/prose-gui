// What an SDRF says about its study, for the "Metadata" window of the SDRF panel: the project, the samples
// (organism, organism part, cell type, disease), how they were measured (instrument, fragmentation, analyzers,
// labels, enzyme, modifications) and the factors of the design, each value with how many rows have it.
// Ontology values ("NT=Orbitrap Fusion;AC=MS:1002416") read as their name with the accession in brackets.

import { cell, columnKey, columns, columnsWith, dataRows, RESERVED, type SdrfTable } from './sdrf-table'

export type SummaryValue = { value: string; rows: number }
export type SummaryItem = { label: string; values: SummaryValue[] }
export type SummarySection = { title: string; items: SummaryItem[] }

/** "NT=Orbitrap Fusion;AC=MS:1002416;…" → "Orbitrap Fusion (MS:1002416)"; other text as it is. */
export function readableTerm(text: string): string {
  const parts = Object.fromEntries(
    text
      .split(';')
      .map((p) => p.split('=') as [string, string])
      .filter((kv) => kv.length === 2)
      .map(([k, v]) => [k.trim().toUpperCase(), v.trim()]),
  )
  if (!parts.NT) return text
  const extra = [parts.MT ? `${parts.MT.toLowerCase()}` : '', parts.TA ? `on ${parts.TA}` : '', parts.PP ? `at ${parts.PP}` : ''].filter(Boolean)
  return `${parts.NT}${extra.length ? `, ${extra.join(' ')}` : ''}${parts.AC ? ` (${parts.AC})` : ''}`
}

/** The values of the columns `cols` over the data rows, most frequent first; reserved words ("not available") last. */
function valuesOf(t: SdrfTable, cols: number[]): SummaryValue[] {
  const counts = new Map<string, number>()
  for (const r of dataRows(t)) {
    for (const c of cols) {
      const v = cell(t, r, c)
      if (v === '') continue
      const key = readableTerm(v)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  const reserved = (v: string) => (RESERVED as readonly string[]).includes(v.toLowerCase())
  return [...counts.entries()]
    .map(([value, rows]) => ({ value, rows }))
    .sort((a, b) => Number(reserved(a.value)) - Number(reserved(b.value)) || b.rows - a.rows || a.value.localeCompare(b.value))
}

/** The name inside the brackets of a column header: "factor value[treatment]" → "treatment". */
const inner = (header: string) => columnKey(header).replace(/^[^[]*\[(.*)\]$/, '$1')

export function sdrfSummary(t: SdrfTable): SummarySection[] {
  const item = (label: string, ...names: string[]): SummaryItem | null => {
    const cols = names.flatMap((n) => columns(t, n))
    const values = valuesOf(t, cols)
    return values.length > 0 ? { label, values } : null
  }
  const keep = (items: (SummaryItem | null)[]) => items.filter((i): i is SummaryItem => i !== null)
  const rows = dataRows(t)
  const sources = new Set(rows.map((r) => cell(t, r, columns(t, 'source name')[0] ?? -1)).filter(Boolean))
  const files = new Set(rows.map((r) => cell(t, r, columns(t, 'comment[data file]')[0] ?? -1)).filter(Boolean))
  const study: SummaryItem[] = keep([
    item('ProteomeXchange', 'comment[proteomexchange accession number]'),
    item('Project', 'comment[project]', 'comment[study title]'),
    { label: 'Size', values: [{ value: `${rows.length} rows · ${sources.size} samples (source names) · ${files.size} data files`, rows: rows.length }] },
  ])
  const characteristics = columnsWith(t, 'characteristics[')
  const known = ['organism', 'organism part', 'cell type', 'disease', 'cell line', 'sex', 'developmental stage']
  const samples: SummaryItem[] = keep([
    ...known.map((k) => item(k[0].toUpperCase() + k.slice(1), `characteristics[${k}]`)),
    ...characteristics
      .filter((c) => !known.includes(inner(t.headers[c])) && !/biological replicate|individual|pool/.test(inner(t.headers[c])))
      .map((c) => {
        const values = valuesOf(t, [c])
        return values.length > 0 ? { label: inner(t.headers[c]), values } : null
      }),
  ])
  const measured: SummaryItem[] = keep([
    item('Instrument', 'comment[instrument]'),
    item('Fragmentation', 'comment[dissociation method]'),
    item('MS2 analyzer', 'comment[ms2 mass analyzer]'),
    item('Label', 'comment[label]'),
    item('Enzyme', 'comment[cleavage agent details]'),
    item('Modifications', 'comment[modification parameters]'),
    item('Precursor tolerance', 'comment[precursor mass tolerance]'),
    item('Fragment tolerance', 'comment[fragment mass tolerance]'),
    item('Fraction', 'comment[fraction identifier]'),
    item('Technical replicate', 'comment[technical replicate]'),
  ])
  const factors: SummaryItem[] = keep(
    columnsWith(t, 'factor value[').map((c) => {
      const values = valuesOf(t, [c])
      return values.length > 0 ? { label: inner(t.headers[c]), values } : null
    }),
  )
  return [
    { title: 'Study', items: study },
    { title: 'Samples', items: samples },
    { title: 'Measurement', items: measured },
    { title: 'Factors of the design', items: factors },
  ].filter((s) => s.items.length > 0)
}
