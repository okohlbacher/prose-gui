import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveDesign } from './model'
import { cleavageAgent, exportSdrf, modificationParameter } from './sdrf-export'
import { cell, column, columns, dataRows, parseSdrfTable, validateSdrf } from './sdrf-table'

const fixture = (name: string) => readFileSync(new URL(`./sdrf-fixtures/${name}`, import.meta.url), 'utf8')
const values = {
  enzyme: 'Trypsin',
  'modifications:fixed': ['Carbamidomethyl (C)'],
  'modifications:variable': ['Oxidation (M)', 'Acetyl (Protein N-term)'],
  'precursor:mass_tolerance_lower': 10,
  'precursor:mass_tolerance_upper': 10,
  'precursor:mass_tolerance_unit': 'ppm',
  'fragment:mass_tolerance': 0.02,
  'fragment:mass_tolerance_unit': 'Da',
}
const settings = { values, appVersion: '0.1.4' }

describe('exportSdrf', () => {
  it('writes modifications and enzymes in SDRF form', () => {
    expect(modificationParameter('Oxidation (M)', 'Variable')).toBe('NT=Oxidation;AC=UNIMOD:35;TA=M;MT=Variable')
    expect(modificationParameter('Acetyl (Protein N-term)', 'Variable')).toBe('NT=Acetyl;AC=UNIMOD:1;PP=Protein N-term;MT=Variable')
    expect(modificationParameter('Gln->pyro-Glu (N-term Q)', 'Variable')).toBe('NT=Gln->pyro-Glu;AC=UNIMOD:28;PP=Any N-term;TA=Q;MT=Variable')
    expect(cleavageAgent('Trypsin')).toBe('NT=Trypsin;AC=MS:1001251')
    expect(cleavageAgent('V8-DE')).toBe('NT=V8-DE')
  })

  it('fills only empty cells and missing columns of the loaded SDRF', () => {
    const design = resolveDesign([
      { id: 'a', fileName: 'Ecoli_1.mzML', fileSize: 0, condition: 'wild type', replicate: 1, fraction: 1, techReplicate: 1 },
    ])
    const t = parseSdrfTable(exportSdrf(fixture('lfq.sdrf.tsv'), design, settings))
    const at = (name: string, k = 0) => dataRows(t).map((r) => cell(t, r, columns(t, name)[k]))
    // the SDRF's own modifications stay; a third column takes the acetylation
    expect(at('comment[modification parameters]', 0)[0]).toBe('NT=Carbamidomethyl;AC=UNIMOD:4;TA=C;MT=Fixed')
    expect(at('comment[modification parameters]', 2)).toEqual(['NT=Acetyl;AC=UNIMOD:1;PP=Protein N-term;MT=Variable', 'NT=Acetyl;AC=UNIMOD:1;PP=Protein N-term;MT=Variable'])
    expect(at('comment[cleavage agent details]')).toEqual(['NT=Trypsin;AC=MS:1001251', 'NT=Trypsin;AC=MS:1001251'])
    expect(at('comment[precursor mass tolerance]')[0]).toBe('10 ppm')
    expect(at('comment[fragment mass tolerance]')[0]).toBe('0.02 Da')
    expect(at('comment[sdrf version]')[0]).toBe('v1.1.0')
    expect(at('comment[sdrf annotation tool]')[0]).toBe('prose-gui 0.1.4')
    expect(at('comment[label]')).toEqual(['label free sample', 'label free sample'])
    // the factor value stays last
    expect(t.headers[t.headers.length - 1]).toBe('factor value[disease]')
    expect(validateSdrf(t).filter((i) => i.level === 'error')).toEqual([])
  })

  it('makes an SDRF from the design table without one', () => {
    const design = resolveDesign([
      { id: 'a', fileName: 'x_F1.mzML', fileSize: 0, condition: 'EGF', fraction: 1 },
      { id: 'b', fileName: 'x_F2.mzML', fileSize: 0, condition: 'EGF', fraction: 2 },
    ])
    const t = parseSdrfTable(exportSdrf(null, design, settings))
    expect(t.headers[0]).toBe('source name')
    expect(dataRows(t).map((r) => cell(t, r, column(t, 'comment[fraction identifier]')))).toEqual(['1', '2'])
    expect(dataRows(t).map((r) => cell(t, r, column(t, 'source name')))).toEqual(['EGF 1', 'EGF 1'])
    expect(validateSdrf(t)).toEqual([])
  })

  it('names a Bruker .d folder as the data file and adds the sample columns as not available', () => {
    const design = resolveDesign([{ id: 'a', fileName: 'run1.d', fileSize: 0 }])
    const t = parseSdrfTable(exportSdrf(null, design, settings))
    expect(cell(t, 0, column(t, 'comment[data file]'))).toBe('run1.d')
    for (const c of ['characteristics[organism]', 'characteristics[organism part]', 'characteristics[disease]', 'characteristics[cell type]'])
      expect(cell(t, 0, column(t, c))).toBe('not available')
  })
})
