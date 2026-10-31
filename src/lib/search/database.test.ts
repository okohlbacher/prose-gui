import { describe, expect, test } from 'vitest'
import type { FastaSummary } from '../desktop'
import { parseSdrfTable } from '../design/sdrf-table'
import { databaseChecks, fastaLine, sdrfOrganisms } from './database'

// The database card's summary and checks (G6).

const summary = (over: Partial<FastaSummary> = {}): FastaSummary => ({
  organisms: [['Homo sapiens', 20000], ['Mus musculus', 5]],
  withOrganism: 20005,
  organismCount: 2,
  uniprot: 20005,
  isoforms: 1500,
  contaminants: 0,
  decoys: 0,
  decoyMarker: null,
  ...over,
})

describe('the database', () => {
  test('one line of its entries', () => {
    expect(fastaLine(summary(), 20005)).toBe('Homo sapiens (20,000 of 20,005 entries) · 2 organisms · UniProt headers · 1,500 isoforms · no decoys')
    expect(fastaLine(summary({ organisms: [], organismCount: 0, uniprot: 0, isoforms: 0, decoys: 10, decoyMarker: 'rev_…' }), 20)).toBe(
      'no organism in the headers · 10 decoys (rev_…)',
    )
  })

  test('decoys of its own while the setting generates more: a warning with the fix', () => {
    let set = ''
    const [c] = databaseChecks(summary({ decoys: 20000, decoyMarker: 'DECOY_…' }), 'generate', [], (v) => (set = v))
    expect(c).toMatchObject({ id: 'decoys-twice', level: 'warn' })
    c.action!.run()
    expect(set).toBe('auto')
    expect(databaseChecks(summary({ decoys: 20000, decoyMarker: 'DECOY_…' }), 'auto', [], () => {})).toEqual([])
  })

  test('a few decoys for many targets under auto: a block (ProSE refuses it) with Generate as the fix; one per target passes', () => {
    let set = ''
    const db = (proteins: number) => ({ path: '/db/x.fasta', proteins })
    const [c] = databaseChecks(summary({ decoys: 3, decoyMarker: 'DECOY_…' }), 'auto', [], (v) => (set = v), db(20003))
    expect(c).toMatchObject({ id: 'decoy-ratio', level: 'block', files: ['/db/x.fasta'] })
    expect(c.overridable).toBeUndefined()
    expect(c.message).toMatch(/^The database has 3 decoys \(marked DECOY_…\) for 20,000 targets/)
    c.action!.run()
    expect(set).toBe('generate')
    expect(databaseChecks(summary({ decoys: 20000, decoyMarker: 'DECOY_…' }), 'auto', [], () => {}, db(40000))).toEqual([])
    // while the proteins are counted, nothing yet
    expect(databaseChecks(summary({ decoys: 3, decoyMarker: 'DECOY_…' }), 'auto', [], () => {}, { path: '/db/x.fasta', proteins: null })).toEqual([])
  })

  test("the SDRF's organism against the database's: by genus and species; any organism of the database will do", () => {
    const sdrf = parseSdrfTable('source name\tcharacteristics[organism]\ns1\tHomo sapiens (human)\ns2\tnot available\n')
    expect(sdrfOrganisms(sdrf)).toEqual(['Homo sapiens (human)'])
    expect(databaseChecks(summary(), 'auto', sdrfOrganisms(sdrf), () => {})).toEqual([])
    expect(databaseChecks(summary(), 'auto', ['Mus musculus'], () => {})).toEqual([])
    const [c] = databaseChecks(summary(), 'auto', ['Escherichia coli'], () => {})
    expect(c.message).toBe("The SDRF names Escherichia coli as the organism, but the database's entries are mostly Homo sapiens. Check that it is the right database.")
  })
})
