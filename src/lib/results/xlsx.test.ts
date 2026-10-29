import { strFromU8, unzipSync } from 'fflate'
import { expect, test } from 'vitest'
import { cutoffs, sampleDesign, sampleTables } from './fixtures'
import { defaultFilters } from './filters'
import { buildModel } from './model'
import { toXlsx } from './csv'

test('a table as a workbook: the CSV columns, numbers as numbers, text as inline strings', () => {
  const m = buildModel(sampleTables(), sampleDesign(), { showTechReplicates: false, ...cutoffs })
  const book = unzipSync(toXlsx(m, 'proteins', Uint32Array.from([0, 1]), ['accession', 'description', 'psms'], { ...defaultFilters(), showDecoys: true }, 'proteins'))
  expect(Object.keys(book)).toContain('xl/worksheets/sheet1.xml')
  const sheet = strFromU8(book['xl/worksheets/sheet1.xml'])
  expect(sheet).toContain('<c r="A1" t="inlineStr"><is><t xml:space="preserve">Accession</t></is></c>')
  expect(sheet).toContain('Serum albumin, mature chain')
  expect(sheet).toMatch(/<c r="C2"><v>4<\/v><\/c>/)
  expect(sheet).not.toContain('<f>')
})
