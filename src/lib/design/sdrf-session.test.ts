import { describe, expect, it } from 'vitest'
import { fileStatus } from './sdrf-session.svelte'

describe('fileStatus', () => {
  const none = { exact: null, mzml: null }
  it('prefers the file named, then an mzML of its stem', () => {
    expect(fileStatus('a.raw', { exact: '/x/a.raw', mzml: '/x/a.mzML' }, '')).toEqual({ status: 'found', path: '/x/a.raw' })
    expect(fileStatus('a.raw', { exact: null, mzml: '/x/a.mzML' }, '')).toEqual({ status: 'mzml', path: '/x/a.mzML' })
    expect(fileStatus('a.wiff', { exact: '/x/a.wiff', mzml: '/x/a.mzML' }, '')).toEqual({ status: 'mzml', path: '/x/a.mzML' })
    expect(fileStatus('B.d', { exact: '/x/B.d', mzml: null }, '')).toEqual({ status: 'found', path: '/x/B.d' })
  })
  it('tells a vendor file, a remote one and a missing one apart', () => {
    expect(fileStatus('a.wiff', { exact: '/x/a.wiff', mzml: null }, '')).toEqual({ status: 'vendor', path: '/x/a.wiff' })
    expect(fileStatus('a.wiff', none, 'ftp://h/a.wiff')).toEqual({ status: 'remote', path: null })
    expect(fileStatus('a.wiff', none, 'not available')).toEqual({ status: 'missing', path: null })
  })
})

describe('designChanges', () => {
  it('reports the design fields an SDRF edit changed, per file', async () => {
    const { designChanges } = await import('./sdrf-session.svelte')
    const { parseSdrfTable, setCell, column } = await import('./sdrf-table')
    const text =
      'source name\tcharacteristics[biological replicate]\tcomment[data file]\tcomment[fraction identifier]\tcomment[label]\tfactor value[treatment]\n' +
      's1\t1\ta.mzML\t1\tlabel free sample\tcontrol\n' +
      's2\t2\tb.mzML\t1\tlabel free sample\tcontrol\n'
    const before = parseSdrfTable(text)
    const after = parseSdrfTable(text)
    setCell(after, 0, column(after, 'factor value[treatment]'), 'EGF')
    setCell(after, 1, column(after, 'comment[fraction identifier]'), '2')
    setCell(after, 1, column(after, 'characteristics[biological replicate]'), 'not available')
    expect(designChanges(before, after)).toEqual([
      { fileName: 'a.mzML', fields: { condition: 'EGF' } },
      { fileName: 'b.mzML', fields: { replicate: undefined, fraction: 2 } },
    ])
    // no edit, no change
    expect(designChanges(before, before)).toEqual([])
  })
})
