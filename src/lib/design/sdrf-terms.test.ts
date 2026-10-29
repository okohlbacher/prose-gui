import { describe, expect, it } from 'vitest'
import { addTemplateColumns, choices, columnKind, fillRows, termValue } from './sdrf-terms'
import { cell, column, dataRows, parseSdrfTable } from './sdrf-table'

describe('SDRF terms', () => {
  it('knows the ontologies and the form of a column', () => {
    expect(columnKind('Characteristics[Organism Part]').ontologies).toContain('uberon')
    expect(columnKind('characteristics[cell type]').ontologies).toContain('cl')
    const instrument = columnKind('comment[instrument]')
    expect(instrument.form).toBe('ntac')
    expect(termValue(instrument, { label: 'Q Exactive', accession: 'MS:1001911' })).toBe('NT=Q Exactive;AC=MS:1001911')
    expect(choices(instrument)).toContain('NT=Q Exactive HF;AC=MS:1002523')
    expect(choices(columnKind('characteristics[organism]'))).toContain('Homo sapiens')
    expect(choices(columnKind('comment[label]'))).toContain('TMT126')
    expect(choices(columnKind('comment[whatever]'))).toEqual(['not available', 'not applicable', 'anonymized', 'pooled'])
  })

  it('adds the required and recommended columns of templates, before the factor values', () => {
    const t = parseSdrfTable('source name\tcomment[data file]\tfactor value[x]\ns\ta.mzML\tp\n')
    const added = addTemplateColumns(t, ['ms-proteomics', 'human'])
    expect(added).toContain('comment[instrument]')
    expect(added).toContain('characteristics[sex]')
    expect(added).not.toContain('comment[data file]')
    expect(t.headers[t.headers.length - 1]).toBe('factor value[x]')
    expect(cell(t, 0, column(t, 'characteristics[sex]'))).toBe('not available')
    fillRows(t, dataRows(t), column(t, 'characteristics[sex]'), 'female')
    expect(cell(t, 0, column(t, 'characteristics[sex]'))).toBe('female')
  })
})
