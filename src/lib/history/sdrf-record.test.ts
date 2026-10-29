import { describe, expect, it } from 'vitest'
import { resolveDesign } from '../design/model'
import { endedRecordOf, parseRecord, resultFromRecord } from './history'

const search = {
  id: 's1',
  createdAt: '2026-10-29T00:00:00Z',
  design: resolveDesign([{ id: 'f1', fileName: 'a.mzML', fileSize: 0 }]),
  psmFdr: 0.01,
  proteinFdr: 0.01,
  seconds: 1,
  settings: { parameters: {}, fixedMods: [], database: 'db.fasta', rescore: true, peptdeep: false, contaminants: true },
}

describe('the SDRF in the search record', () => {
  it('goes into search.json and comes back with the result', () => {
    const sdrf = { name: 'x.sdrf.tsv', text: 'source name\tcomment[data file]\ns\ta.mzML\n' }
    const record = parseRecord(JSON.stringify(endedRecordOf({ ...search, sdrf }, 'n', '1', 0)))
    expect(record.sdrf).toEqual(sdrf)
    expect(resultFromRecord(record, {} as never).sdrf).toEqual(sdrf)
  })
  it('is absent without one, and a broken one is refused', () => {
    const record = endedRecordOf(search, 'n', '1', 0)
    expect('sdrf' in record).toBe(false)
    expect(() => parseRecord(JSON.stringify({ ...record, sdrf: { name: 1 } }))).toThrow('sdrf is broken')
  })
})
