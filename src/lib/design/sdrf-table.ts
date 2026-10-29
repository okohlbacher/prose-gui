// An SDRF file as it is: its columns in order (names may repeat: several comment[modification parameters]),
// its rows as written, and enough of its layout (byte-order mark, line ending, last newline) that an unchanged
// file is written back byte for byte. Columns are found by their normalised name (`columnKey`), never by the
// name alone. SDRF-Proteomics v1.1.0.

export type SdrfTable = {
  /** The header cells as written (repeats kept). */
  headers: string[]
  /** The lines after the header, split at tabs, cells untrimmed. A blank line is `['']`. */
  rows: string[][]
  bom: boolean
  eol: '\n' | '\r\n' | '\r'
  /** The text ends with a line ending. */
  trailingEol: boolean
}

/** Issues of `validateSdrf`: `row` is the index into `SdrfTable.rows` (-1: the header), `col` into `headers` (-1: none). */
export type SdrfIssue = { level: 'error' | 'warning'; row: number; col: number; message: string }

/** Values SDRF reserves, which it writes in lower case. */
export const RESERVED = ['not available', 'not applicable', 'anonymized', 'pooled'] as const

/** Older names of columns, by their current name. */
const ALIASES: Record<string, string> = {
  'comment[ms2 analyzer type]': 'comment[ms2 mass analyzer]',
}

/** A column's name for lookup: lower case, no space before "[" or inside the brackets' edges, and an old name as the current one. */
export function columnKey(header: string): string {
  const k = header
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*\[\s*/, '[')
    .replace(/\s*\]$/, ']')
  return ALIASES[k] ?? k
}

export function parseSdrfTable(text: string): SdrfTable {
  const bom = text.startsWith('﻿')
  const body = bom ? text.slice(1) : text
  const eol = (body.match(/\r\n|\n|\r/)?.[0] ?? '\n') as SdrfTable['eol']
  // ponytail: one line ending per file; a file that mixes them is written back with its first one
  const lines = body.split(/\r\n|\n|\r/)
  const trailingEol = lines.length > 1 && lines[lines.length - 1] === ''
  if (trailingEol) lines.pop()
  const [header = '', ...rest] = lines
  return { headers: header === '' ? [] : header.split('\t'), rows: rest.map((l) => l.split('\t')), bom, eol, trailingEol }
}

export function writeSdrfTable(t: SdrfTable): string {
  const lines = [t.headers.join('\t'), ...t.rows.map((r) => r.join('\t'))]
  return (t.bom ? '﻿' : '') + lines.join(t.eol) + (t.trailingEol ? t.eol : '')
}

/** The indices of all columns named `name` (any case, old names too), in order. */
export function columns(t: SdrfTable, name: string): number[] {
  const key = columnKey(name)
  return t.headers.flatMap((h, i) => (columnKey(h) === key ? [i] : []))
}

/** The first column named `name`, or -1. */
export function column(t: SdrfTable, name: string): number {
  return columns(t, name)[0] ?? -1
}

/** The indices of the columns whose normalised names start with `prefix` ("factor value[", "characteristics["). */
export function columnsWith(t: SdrfTable, prefix: string): number[] {
  return t.headers.flatMap((h, i) => (columnKey(h).startsWith(prefix) ? [i] : []))
}

/** The trimmed cell, '' if the row is short or there is no such column. */
export function cell(t: SdrfTable, row: number, col: number): string {
  return col < 0 ? '' : (t.rows[row]?.[col] ?? '').trim()
}

/** Sets a cell, padding a short row with empty cells. */
export function setCell(t: SdrfTable, row: number, col: number, value: string) {
  const r = t.rows[row]
  while (r.length <= col) r.push('')
  r[col] = value.replace(/[\t\r\n]+/g, ' ')
}

/** Appends a column (empty in every data row, `fill` if given) and returns its index. */
export function addColumn(t: SdrfTable, header: string, fill = ''): number {
  const col = t.headers.length
  t.headers.push(header)
  for (const [i, r] of t.rows.entries()) {
    if (isBlank(r)) continue
    while (r.length < col) r.push('')
    setCell(t, i, col, fill)
  }
  return col
}

export const isBlank = (row: string[]) => row.every((c) => c.trim() === '')

/** The indices of the rows that are not blank. */
export function dataRows(t: SdrfTable): number[] {
  return t.rows.flatMap((r, i) => (isBlank(r) ? [] : [i]))
}

/** The empty or reserved values: "not available" and "not applicable" (any case) count as no value. */
export const noValue = (value: string) => value === '' || /^not (available|applicable)$/i.test(value)

/** The last segment of a URI or path, without a query or fragment, URL-decoded. */
export function lastSegment(uri: string): string {
  const path = uri.replace(/[?#].*$/, '').replace(/[\\/]+$/, '')
  const last = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

/**
 * The rules of SDRF-Proteomics v1.1.0 the app checks: source name first; source name + assay name + label unique;
 * comment[data file] and comment[technical replicate] present and filled; comment[file uri] ending in the data
 * file; associated files and their URIs paired; reserved values in lower case.
 */
export function validateSdrf(t: SdrfTable): SdrfIssue[] {
  const issues: SdrfIssue[] = []
  const rows = dataRows(t)
  if (t.headers.length > 0 && columnKey(t.headers[0]) !== 'source name')
    issues.push({ level: 'error', row: -1, col: 0, message: `The first column must be “source name”, not “${t.headers[0]}”.` })

  const fileCol = column(t, 'comment[data file]')
  if (fileCol < 0) issues.push({ level: 'error', row: -1, col: -1, message: 'There is no comment[data file] column.' })
  const techCol = column(t, 'comment[technical replicate]')
  if (techCol < 0)
    issues.push({ level: 'warning', row: -1, col: -1, message: 'There is no comment[technical replicate] column (required by SDRF v1.1.0; 1 is assumed).' })

  const sourceCol = column(t, 'source name')
  const assayCol = column(t, 'assay name')
  const labelCol = column(t, 'comment[label]')
  const seen = new Map<string, number>()
  const uriCol = column(t, 'comment[file uri]')
  const assocFiles = columns(t, 'comment[associated data file]')
  const assocUris = columns(t, 'comment[associated file uri]')

  for (const r of rows) {
    if (fileCol >= 0 && cell(t, r, fileCol) === '')
      issues.push({ level: 'error', row: r, col: fileCol, message: 'The data file is empty.' })
    if (techCol >= 0 && cell(t, r, techCol) === '')
      issues.push({ level: 'warning', row: r, col: techCol, message: 'The technical replicate is empty (1 is assumed).' })

    if (assayCol >= 0) {
      const key = [sourceCol, assayCol, labelCol].map((c) => cell(t, r, c)).join('\0')
      const first = seen.get(key)
      if (first === undefined) seen.set(key, r)
      else
        issues.push({
          level: 'error',
          row: r,
          col: assayCol,
          message: `Source name, assay name and label repeat those of row ${first + 1}: each must be unique.`,
        })
    }

    if (uriCol >= 0 && fileCol >= 0) {
      const uri = cell(t, r, uriCol)
      const file = cell(t, r, fileCol)
      if (uri !== '' && !noValue(uri) && file !== '' && lastSegment(uri) !== file)
        issues.push({ level: 'error', row: r, col: uriCol, message: `The file URI ends in “${lastSegment(uri)}”, not in the data file “${file}”.` })
    }

    if (assocFiles.length > 0 && assocUris.length > 0) {
      const filled = (cols: number[]) => cols.map((c) => cell(t, r, c)).filter((v) => !noValue(v))
      const files = filled(assocFiles)
      const uris = filled(assocUris)
      if (uris.length > 0 && files.length !== uris.length)
        issues.push({ level: 'warning', row: r, col: assocUris[0], message: `${files.length} associated data files but ${uris.length} associated file URIs: they pair by position.` })
      for (const [k, uri] of uris.entries())
        if (files[k] !== undefined && lastSegment(uri) !== files[k])
          issues.push({ level: 'error', row: r, col: assocUris[k], message: `The associated file URI ends in “${lastSegment(uri)}”, not in “${files[k]}”.` })
    }

    for (const [c] of t.headers.entries()) {
      const v = cell(t, r, c)
      const lower = v.toLowerCase()
      if (v !== lower && (RESERVED as readonly string[]).includes(lower))
        issues.push({ level: 'warning', row: r, col: c, message: `Reserved values are written in lower case: “${lower}”.` })
    }
  }
  return issues
}

/** A design row of a file of the SDRF: its fields when loaded, now, and as resolved (`ResolvedRow`). */
export type SdrfDesignRow = {
  fileName: string
  before: { condition?: string; replicate?: number; fraction?: number; techReplicate?: number }
  after: { condition?: string; replicate?: number; fraction?: number; techReplicate?: number }
  resolved: { replicate: number; fraction: number; techReplicate: number }
}

const FIELD_COLUMNS = {
  replicate: 'characteristics[biological replicate]',
  fraction: 'comment[fraction identifier]',
  techReplicate: 'comment[technical replicate]',
} as const

/**
 * Writes what the user changed in the design table into the SDRF's own columns (every row of the file: all its
 * labels): the condition into its factor value column (several factors: split at "/" when the parts match), the
 * replicate, fraction and technical replicate into theirs. A column that is not there is added when a value was
 * changed; comment[technical replicate] always (SDRF v1.1.0 requires it). Unchanged files stay as they were.
 */
export function syncDesign(t: SdrfTable, design: SdrfDesignRow[]) {
  const fileCol = column(t, 'comment[data file]')
  if (fileCol < 0) return
  const byFile = new Map(design.map((d) => [d.fileName, d]))
  const rows = dataRows(t)
  const rowsOf = (d: SdrfDesignRow) => rows.filter((r) => cell(t, r, fileCol) === d.fileName)

  for (const [field, name] of Object.entries(FIELD_COLUMNS) as [keyof typeof FIELD_COLUMNS, string][]) {
    const changed = design.filter((d) => d.after[field] !== d.before[field])
    let col = column(t, name)
    if (col < 0) {
      if (changed.length === 0 && field !== 'techReplicate') continue
      col = addColumn(t, name, field === 'techReplicate' ? '1' : 'not available')
      for (const r of rows) {
        const d = byFile.get(cell(t, r, fileCol))
        if (d) setCell(t, r, col, String(d.resolved[field]))
      }
      continue
    }
    for (const d of changed) for (const r of rowsOf(d)) setCell(t, r, col, String(d.after[field] ?? d.resolved[field]))
  }

  const changed = design.filter((d) => (d.after.condition ?? '') !== (d.before.condition ?? ''))
  if (changed.length === 0) return
  let factors = columnsWith(t, 'factor value[')
  if (factors.length === 0) factors = [addColumn(t, 'factor value[condition]', 'not available')]
  for (const d of changed) {
    const value = d.after.condition ?? 'not available'
    const parts = value.split('/')
    for (const r of rowsOf(d)) {
      if (parts.length === factors.length) factors.forEach((c, k) => setCell(t, r, c, parts[k]))
      else setCell(t, r, factors[0], value)
    }
  }
}

/** The stem a QPX run_file_name has: the file name without folders and without its extension (`.mzML.gz` whole). */
export function runStem(name: string): string {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1).replace(/\.gz$/i, '')
  const dot = base.lastIndexOf('.')
  return (dot > 0 ? base.slice(0, dot) : base).toLowerCase()
}

/**
 * The SDRF's characteristics[...] and factor value[...] per searched file, joined on the file stem (a search of
 * run.mzML takes the rows of run.raw): one row per SDRF row of the file (a multiplexed file: one per label).
 * Files the SDRF does not name have empty values.
 */
export function sdrfAnnotations(
  t: SdrfTable,
  files: { fileName: string; sample: string }[],
): { headers: string[]; label: boolean; rows: { fileName: string; sample: string; label: string; values: string[] }[] } {
  const cols = [...columnsWith(t, 'characteristics['), ...columnsWith(t, 'factor value[')]
  const fileCol = column(t, 'comment[data file]')
  const labelCol = column(t, 'comment[label]')
  const byStem = new Map<string, number[]>()
  for (const r of dataRows(t)) {
    const stem = runStem(cell(t, r, fileCol))
    byStem.set(stem, [...(byStem.get(stem) ?? []), r])
  }
  const rows = files.flatMap((f) => {
    const sdrfRows = byStem.get(runStem(f.fileName)) ?? []
    if (sdrfRows.length === 0) return [{ ...f, label: '', values: cols.map(() => '') }]
    return sdrfRows.map((r) => ({ ...f, label: cell(t, r, labelCol), values: cols.map((c) => cell(t, r, c)) }))
  })
  return { headers: cols.map((c) => t.headers[c].trim()), label: new Set(rows.map((r) => r.label)).size > 1, rows }
}
