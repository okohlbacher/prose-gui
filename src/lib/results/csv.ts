// CSV export of a table view: the rows given (the filtered, sorted view), the columns given.

import { strToU8, zipSync } from 'fflate'
import { columnDef, expandColumns } from './columns'
import type { FilterState } from './filters'
import { peptideCounts, type Level, type ResultModel } from './model'

/**
 * Excel and Sheets run a cell that starts with one of these as a formula (CSV injection); text cells
 * get an apostrophe in front, which they show as a text marker. Numeric columns are not touched.
 */
const formulaStart = /^[=+\-@\t\r]/

/** A CSV field: quoted when it holds a comma, a quote or a line break (RFC 4180). */
function field(text: string, isText: boolean): string {
  if (isText && formulaStart.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/**
 * The rows of `level` as CSV for a spreadsheet: a UTF-8 byte order mark, a header line, then one line
 * per row in the order given, each ended by "\n" (so a file of n rows has n + 1 lines). Peptides are
 * written as ProForma (all modifications, fixed ones too), not in the display mode. `columns` are the
 * ids of `columns.ts` ("accession", "psms", "qValue", ...); "samples" stands for one column per sample
 * (proteins and peptides). Missing numbers are empty. Text cells that start with `=`, `+`, `-`, `@`, a
 * tab or a carriage return get a leading apostrophe, as do such headers (sample labels come from
 * file names and conditions).
 *
 * `filters` is the level's filter state that made `rows`: the peptide counts are those at its
 * cutoff (see `peptideCounts`), as in the table and its sort order.
 */
export function toCsv(m: ResultModel, level: Level, rows: Uint32Array, columns: string[], filters: FilterState): string {
  const defs = expandColumns(m, level, columns).map((id) => columnDef(m, level, id)!)
  const counts = peptideCounts(m, level === 'peptides' ? filters.maxQ : NaN)
  const lines: string[] = new Array(rows.length + 1)
  lines[0] = defs.map((d) => field(d.header, true)).join(',')
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    lines[i + 1] = defs
      .map((d) => {
        if (d.csv) return field(d.csv(m, row, counts), d.csvText)
        if (d.number) {
          const x = d.number(m, row, counts)
          return x === x ? String(x) : ''
        }
        return field(d.text!(m, row, counts), d.csvText)
      })
      .join(',')
  }
  return '\uFEFF' + lines.join('\n') + '\n'
}

/** XML text: the five characters XML escapes, and the control characters a worksheet may not hold. */
const xml = (t: string) =>
  t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** A column letter of a 0-based index (A, …, Z, AA, …). */
function columnName(i: number): string {
  let name = ''
  for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) name = String.fromCharCode(65 + ((i - 1) % 26)) + name
  return name
}

/**
 * The rows of `level` as an Excel workbook (.xlsx, one sheet `sheet`), with the columns and rows of `toCsv`:
 * numbers as numbers, text as inline strings (never formulas, so no injection), the header row frozen.
 * Written by hand as the smallest OOXML package (fflate zips it), not with a spreadsheet library.
 */
export function toXlsx(m: ResultModel, level: Level, rows: Uint32Array, columns: string[], filters: FilterState, sheet: string): Uint8Array {
  const defs = expandColumns(m, level, columns).map((id) => columnDef(m, level, id)!)
  const counts = peptideCounts(m, level === 'peptides' ? filters.maxQ : NaN)
  const text = (ref: string, t: string) => `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(t)}</t></is></c>`
  const out: string[] = [`<row r="1">${defs.map((d, j) => text(`${columnName(j)}1`, d.header)).join('')}</row>`]
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const r = i + 2
    const cells = defs.map((d, j) => {
      const ref = `${columnName(j)}${r}`
      if (d.number && !d.csv) {
        const x = d.number(m, row, counts)
        return Number.isFinite(x) ? `<c r="${ref}"><v>${x}</v></c>` : ''
      }
      const t = d.csv ? d.csv(m, row, counts) : d.text!(m, row, counts)
      return t === '' ? '' : text(ref, t)
    })
    out.push(`<row r="${r}">${cells.join('')}</row>`)
  }
  const worksheet =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<sheetData>${out.join('')}</sheetData></worksheet>`
  const ns = 'http://schemas.openxmlformats.org'
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${ns}/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ns}/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships">` +
        `<sheets><sheet name="${xml(sheet.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ns}/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    ),
    'xl/worksheets/sheet1.xml': strToU8(worksheet),
  })
}
