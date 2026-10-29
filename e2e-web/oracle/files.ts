// Reading the exports in the tests: CSV (RFC 4180) and XLSX (the sheet's cells, by their references), written here
// rather than taken from the app, so that a fault of the app's writer cannot cancel out in its own reader.
import { strFromU8, unzipSync } from 'fflate'

/** The rows of a CSV text (a leading byte-order mark dropped), each a list of fields. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '')
  const out: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') (field += '"'), i++
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') row.push(field), (field = '')
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(field)
      out.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length > 0) row.push(field), out.push(row)
  return out
}

const unescape = (t: string) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

/** The cells of the first sheet of an .xlsx, as rows of strings (an absent cell: ''); numbers as written. */
export function parseXlsx(bytes: Uint8Array): string[][] {
  const files = unzipSync(bytes)
  const sheet = files['xl/worksheets/sheet1.xml']
  if (!sheet) throw new Error('no xl/worksheets/sheet1.xml')
  const shared = files['xl/sharedStrings.xml'] ? [...strFromU8(files['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unescape(m[1].replace(/<[^>]+>/g, ''))) : []
  const rows: string[][] = []
  for (const r of strFromU8(sheet).matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = []
    for (const c of r[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+)\d+"/.exec(c[1])![1]
      const col = [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
      const type = /\bt="(\w+)"/.exec(c[1])?.[1]
      const body = c[2] ?? ''
      const value =
        type === 'inlineStr' ? unescape(/<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1] ?? '') : type === 's' ? shared[Number(/<v>(.*?)<\/v>/.exec(body)?.[1])] : unescape(/<v>(.*?)<\/v>/.exec(body)?.[1] ?? '')
      while (cells.length < col) cells.push('')
      cells[col] = value
    }
    rows[Number(r[1]) - 1] = cells
  }
  return Array.from(rows, (r) => r ?? [])
}
