import { expect, test } from 'vitest'
import { resolveDesign } from '../design/model'
import { fractionsWithoutReplicates, scopeLine } from './scope'

test('the scope line names where each FDR is computed', () => {
  expect(scopeLine(4, { 'FDR:PSM_groups': 'scored_charges', 'FDR:protein': 0.01 }, false)).toBe(
    '4 files, 1 search: PSM FDR per file and per fragment-charge group (FDR:PSM_groups), protein FDR across all files',
  )
  expect(scopeLine(1, { 'FDR:PSM_groups': 'pooled', 'FDR:protein': 0 }, false)).toBe('1 file, 1 search: PSM FDR per file, all PSMs pooled (FDR:PSM_groups), no protein FDR')
  expect(scopeLine(2, {}, true)).toBe('2 files, 1 search: no FDR (no decoys)')
})

test('fractions of a single replicate per condition are noted; with replicates they are not', () => {
  const row = (name: string, condition: string, replicate: number, fraction: number) => ({ id: name, fileName: name, fileSize: 1, condition, replicate, fraction })
  expect(fractionsWithoutReplicates(resolveDesign([row('a', 'x', 1, 1), row('b', 'x', 1, 2), row('c', 'y', 1, 1), row('d', 'y', 1, 2)]))).toMatch(/^The files are fractions/)
  expect(fractionsWithoutReplicates(resolveDesign([row('a', 'x', 1, 1), row('b', 'x', 1, 2), row('c', 'x', 2, 1), row('d', 'x', 2, 2)]))).toBeNull()
  expect(fractionsWithoutReplicates(resolveDesign([row('a', 'x', 1, 1), row('b', 'y', 1, 1)]))).toBeNull()
})
