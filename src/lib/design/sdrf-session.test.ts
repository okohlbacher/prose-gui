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
