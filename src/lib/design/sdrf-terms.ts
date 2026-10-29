// What the SDRF editor offers for a column: its bundled terms (sdrf-vocab.json, made by scripts/sdrf-vocab.py),
// the ontologies to search in OLS (from the templates of sdrf-pipelines, sdrf-templates.json, made by
// scripts/sdrf-templates.py), and how a chosen term is written: its label, or NT=..;AC=.. where SDRF uses that.

import templatesJson from './sdrf-templates.json'
import vocabJson from './sdrf-vocab.json'
import { addColumn, columnKey, columns, RESERVED, type SdrfTable } from './sdrf-table'

export type Term = { label: string; accession: string }
export type ColumnKind = { local: Term[]; ontologies: string[]; form: 'label' | 'ntac' }
export type Template = { name: string; version: string; description: string; layer: string; columns: { name: string; requirement: string; ontologies: string[] }[] }

export const TEMPLATES = templatesJson.templates as Template[]
const VOCAB = vocabJson as Record<string, Term[]>

/** Columns whose values SDRF writes as NT=label;AC=accession. */
const NTAC = new Set(['comment[instrument]', 'comment[cleavage agent details]', 'comment[dissociation method]', 'comment[ms2 mass analyzer]'])

/** Where the templates name no ontology. */
const FALLBACK: Record<string, string[]> = {
  'characteristics[organism]': ['ncbitaxon'],
  'characteristics[organism part]': ['uberon'],
  'characteristics[cell type]': ['cl'],
  'characteristics[disease]': ['mondo', 'efo'],
}

const ontologiesOf = new Map<string, string[]>()
for (const t of TEMPLATES) for (const c of t.columns) if (c.ontologies.length > 0 && !ontologiesOf.has(columnKey(c.name))) ontologiesOf.set(columnKey(c.name), c.ontologies)

export function columnKind(header: string): ColumnKind {
  const key = columnKey(header)
  return {
    local: VOCAB[key] ?? [],
    ontologies: ontologiesOf.get(key) ?? FALLBACK[key] ?? [],
    form: NTAC.has(key) ? 'ntac' : 'label',
  }
}

/** The cell text of `term` in a column of `kind`. */
export function termValue(kind: ColumnKind, term: Term): string {
  return kind.form === 'ntac' && term.accession ? `NT=${term.label};AC=${term.accession}` : term.label
}

/** What a cell can be set to without typing: the reserved values, then the column's bundled terms. */
export function choices(kind: ColumnKind): string[] {
  return [...RESERVED, ...kind.local.map((t) => termValue(kind, t))]
}

/**
 * Adds the columns of the templates `names` that the SDRF lacks (required and recommended ones; "not available"
 * in every row) and returns their names.
 */
export function addTemplateColumns(t: SdrfTable, names: string[]): string[] {
  const added: string[] = []
  for (const name of names) {
    for (const c of TEMPLATES.find((x) => x.name === name)?.columns ?? []) {
      if (c.requirement === 'optional' || columns(t, c.name).length > 0) continue
      addColumn(t, c.name, 'not available')
      added.push(c.name)
    }
  }
  return added
}

/** Sets column `col` of `rows` to `value` (fill down / apply to the selected rows). */
export function fillRows(t: SdrfTable, rows: number[], col: number, value: string) {
  for (const r of rows) {
    const row = t.rows[r]
    while (row.length <= col) row.push('')
    row[col] = value.replace(/[\t\r\n]+/g, ' ')
  }
}
