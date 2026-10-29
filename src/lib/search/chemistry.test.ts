import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseSdrfTable } from '../design/sdrf-table'
import { modificationParameter } from '../design/sdrf-export'
import { parseSdrfModification, sdrfChemistryChecks } from './chemistry'

// The SDRF's chemistry against the search (G2).

describe("the SDRF's modifications and labels", () => {
  test('SDRF modification strings as ProSE names them, also what the export writes', () => {
    expect(parseSdrfModification('NT=Phospho;AC=UNIMOD:21;TA=S,T,Y;MT=Variable')).toMatchObject({ names: ['Phospho (S)', 'Phospho (T)', 'Phospho (Y)'], type: 'variable' })
    expect(parseSdrfModification('NT=Acetyl;AC=UNIMOD:1;PP=Protein N-term;MT=variable')!.names).toEqual(['Acetyl (Protein N-term)'])
    for (const mod of ['Carbamidomethyl (C)', 'Acetyl (Protein N-term)', 'TMT6plex (N-term)', 'Oxidation (M)']) {
      expect(parseSdrfModification(modificationParameter(mod, 'Fixed'))!.names).toEqual([mod])
    }
    expect(parseSdrfModification('not available')).toBeNull()
  })

  test('the TMT fixture: its label modifications are missing from a label-free search', () => {
    const table = parseSdrfTable(readFileSync(new URL('../design/sdrf-fixtures/tmt.sdrf.tsv', import.meta.url), 'utf8'))
    const checks = sdrfChemistryChecks(table, ['Carbamidomethyl (C)'], ['Oxidation (M)'])
    expect(checks.map((c) => c.id)).toContain('sdrf-label')
  })

  test('nothing to say when the search has what the SDRF lists', () => {
    const table = parseSdrfTable(
      'source name\tcomment[label]\tcomment[modification parameters]\tcomment[modification parameters]\n' +
        's1\tTMT126\tNT=TMT6plex;TA=K;MT=Fixed\tNT=Carbamidomethyl;TA=C;MT=Fixed\n',
    )
    expect(sdrfChemistryChecks(table, ['TMT6plex (K)', 'Carbamidomethyl (C)'], [])).toEqual([])
    const [c] = sdrfChemistryChecks(table, ['Carbamidomethyl (C)'], [])
    expect(c.message).toBe('The SDRF lists a modification the search does not include: TMT6plex (K) (fixed). Add it under Search settings, or correct the SDRF.')
  })
})
