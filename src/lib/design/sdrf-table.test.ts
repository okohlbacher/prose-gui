import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseSdrf } from './sdrf'
import {
  cell,
  column,
  columnKey,
  columns,
  dataRows,
  lastSegment,
  parseSdrfTable,
  sdrfAnnotations,
  sdrfFilterOptions,
  syncDesign,
  validateSdrf,
  writeSdrfTable,
} from './sdrf-table'

const fixture = (name: string) => readFileSync(new URL(`./sdrf-fixtures/${name}`, import.meta.url), 'utf8')

describe('SDRF table', () => {
  it('writes every fixture back byte for byte', () => {
    for (const name of ['lfq.sdrf.tsv', 'tmt.sdrf.tsv', 'ecoli.sdrf.tsv']) {
      const text = fixture(name)
      expect(writeSdrfTable(parseSdrfTable(text))).toBe(text)
    }
    for (const text of ['\ufeffa\tb\nc\t d \n', 'a\tb\r\n\r\nc\r\n', 'a\rb', 'only header', '', 'a\t\tb\n1\n']) {
      expect(writeSdrfTable(parseSdrfTable(text))).toBe(text)
    }
  })

  it('keeps repeated columns and finds them by normalised name, old names too', () => {
    const t = parseSdrfTable(fixture('lfq.sdrf.tsv'))
    expect(t.eol).toBe('\r\n')
    expect(columns(t, 'comment[modification parameters]')).toHaveLength(2)
    expect(columns(t, 'Comment[Associated Data File]')).toHaveLength(2)
    expect(column(t, 'comment[MS2 mass analyzer]')).toBe(t.headers.indexOf('comment[MS2 analyzer type]'))
    expect(columnKey('Characteristics [Organism] ')).toBe('characteristics[organism]')
    expect(cell(t, 1, column(t, 'comment[data file]'))).toBe('B1.d')
  })

  it('reports the rules of SDRF v1.1.0 per cell', () => {
    const lfq = parseSdrfTable(fixture('lfq.sdrf.tsv'))
    expect(validateSdrf(lfq).map((i) => [i.level, i.row, lfq.headers[i.col]])).toEqual([
      ['warning', 1, 'comment[MS2 analyzer type]'], // "Not Available"
    ])

    const bad = parseSdrfTable(
      [
        'assay name\tsource name\tcomment[label]\tcomment[data file]\tcomment[file uri]',
        'run1\ts1\tTMT126\ta.raw\thttp://x/a.raw',
        'run1\ts1\tTMT126\ta.raw\thttp://x/b.raw?dl=1',
        'run1\ts1\tTMT127\t\t',
      ].join('\n'),
    )
    const issues = validateSdrf(bad).map((i) => `${i.level} ${i.row} ${i.col}`)
    expect(issues).toEqual([
      'error -1 0', // source name not first
      'warning -1 -1', // no technical replicate
      'error 1 0', // duplicate source + assay + label
      'error 1 4', // URI does not end in the data file
      'error 2 3', // empty data file
    ])
  })

  it('accepts TMT rows sharing an assay name with distinct labels', () => {
    const t = parseSdrfTable(fixture('tmt.sdrf.tsv'))
    expect(validateSdrf(t).filter((i) => i.level === 'error')).toEqual([])
    expect(dataRows(t)).toHaveLength(4)
  })

  it('takes the last segment of a URI', () => {
    expect(lastSegment('ftp://h/p/A%201.raw')).toBe('A 1.raw')
    expect(lastSegment('https://h/B.d/')).toBe('B.d')
    expect(lastSegment('C:\\data\\c.mzML')).toBe('c.mzML')
  })
})

describe('syncDesign', () => {
  it('leaves an unchanged file as it was, but adds a missing technical replicate', () => {
    const text = fixture('ecoli.sdrf.tsv')
    const t = parseSdrfTable(text)
    syncDesign(t, [])
    expect(writeSdrfTable(t)).toBe(text)

    const tmt = parseSdrfTable(fixture('tmt.sdrf.tsv'))
    syncDesign(tmt, [
      { fileName: 'tmt_run1.raw', before: {}, after: {}, resolved: { replicate: 1, fraction: 1, techReplicate: 1 } },
    ])
    const tech = column(tmt, 'comment[technical replicate]')
    expect(dataRows(tmt).map((r) => cell(tmt, r, tech))).toEqual(['1', '1', '1', '1'])
  })

  it('writes edits into the columns they came from, for all labels of a file', () => {
    const t = parseSdrfTable(fixture('tmt.sdrf.tsv'))
    const before = parseSdrf(fixture('tmt.sdrf.tsv')).inputs
    // (its channels disagree on the treatment: no condition)
    expect(before[1]).toEqual({ fileName: 'tmt_run2.raw', replicate: 2, fraction: 1 })
    syncDesign(t, [
      {
        fileName: 'tmt_run2.raw',
        before: before[1],
        after: { ...before[1], condition: 'EGF', fraction: 3 },
        resolved: { replicate: 2, fraction: 3, techReplicate: 1 },
      },
    ])
    const at = (name: string) => dataRows(t).map((r) => cell(t, r, column(t, name)))
    expect(at('factor value[treatment]')).toEqual(['control', 'EGF', 'EGF', 'EGF'])
    expect(at('comment[fraction identifier]')).toEqual(['1', '1', '3', '3'])
    expect(at('characteristics[biological replicate]')).toEqual(['1', '1', '2', '2'])
  })

  it('splits a joined condition over several factor columns', () => {
    const t = parseSdrfTable('source name\tcomment[data file]\tfactor value[a]\tfactor value[b]\ns\tx.mzML\tp\tq\n')
    syncDesign(t, [
      { fileName: 'x.mzML', before: { condition: 'p/q' }, after: { condition: 'r/s' }, resolved: { replicate: 1, fraction: 1, techReplicate: 1 } },
    ])
    expect(t.rows[0]).toEqual(['s', 'x.mzML', '1', 'r', 's'])
  })
})

describe('sdrfAnnotations', () => {
  it('joins on the file stem, one row per label', () => {
    const t = parseSdrfTable(fixture('tmt.sdrf.tsv'))
    const a = sdrfAnnotations(t, [
      { fileName: 'tmt_run1.mzML', sample: 'S1' },
      { fileName: 'other.mzML.gz', sample: 'S2' },
    ])
    expect(a.headers).toEqual(['characteristics[organism]', 'characteristics[biological replicate]', 'factor value[treatment]'])
    expect(a.label).toBe(true)
    expect(a.rows.map((r) => [r.fileName, r.label, r.values.join('|')])).toEqual([
      ['tmt_run1.mzML', 'TMT126', 'Homo sapiens|1|control'],
      ['tmt_run1.mzML', 'TMT127N', 'Homo sapiens|1|EGF'],
      ['other.mzML.gz', '', '||'],
    ])
  })
})

describe('sdrfFilterOptions', () => {
  it('offers the columns whose values tell the searched files apart', () => {
    const t = parseSdrfTable(fixture('tmt.sdrf.tsv'))
    expect(sdrfFilterOptions(t, ['tmt_run1.mzML', 'tmt_run2.mzML'])).toEqual([
      { column: 'characteristics[biological replicate]', values: [{ value: '1', files: [0] }, { value: '2', files: [1] }] },
      // (both runs have both treatments, one per channel)
      { column: 'factor value[treatment]', values: [{ value: 'control', files: [0, 1] }, { value: 'EGF', files: [0, 1] }] },
    ])
  })
})
