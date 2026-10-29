import { expect, test } from 'vitest'
import { methodsText } from './methods'
import type { ProSEMultiSummary } from './types'

const summary = (proteinFdrApplied: boolean, psmFdr = 0.01) =>
  ({
    files: [{}, {}],
    search: { enzyme: 'Trypsin', decoyMode: 'reverse', targetProteins: 4300, decoyProteins: 4300 },
    openSearch: false,
    psmFdr,
    proteinFdr: 0.01,
    proteinFdrApplied,
  }) as unknown as ProSEMultiSummary
const settings = { database: '/home/me/ecoli.fasta', contaminants: true, fixedMods: ['Carbamidomethyl (C)'], parameters: {}, rescore: true, peptdeep: false }

test('never claims a protein FDR that was not applied, and leaks no paths', () => {
  const text = methodsText({ summary: summary(false), settings, version: '3.5.0' })
  expect(text).toContain('No protein-level FDR was applied')
  expect(text).not.toMatch(/protein-level FDR\.$/)
  expect(text).not.toContain('/home/me')
  expect(text).toContain('ecoli.fasta (4,300 target entries, with common contaminants, 4,300 decoys (reverse))')
  expect(methodsText({ summary: summary(true), settings, version: '' })).toContain('filtered at 1 % protein-level FDR')
  expect(methodsText({ summary: summary(false, 0), settings, version: '' })).toContain('not FDR-controlled')
})
