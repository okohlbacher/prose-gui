import { describe, expect, it } from 'vitest'
import { brukerFolder, isFasta, isSpectrum } from './files'

// (the spectrum and protein counts moved to the shim: src-tauri/tests/files.rs)
describe('files', () => {
  it('recognises the file types by extension, as the shim accepts them', () => {
    expect(isSpectrum('run.mzML')).toBe(true)
    expect(isSpectrum('RUN.MZML')).toBe(true)
    expect(isSpectrum('run.mzML.gz')).toBe(true)
    expect(isSpectrum('run.raw')).toBe(true)
    expect(isSpectrum('run.gz')).toBe(false)
    expect(isFasta('db.fasta')).toBe(true)
    expect(isFasta('db.fa')).toBe(true)
    expect(isFasta('db.faa')).toBe(true)
    expect(isFasta('db.fas')).toBe(false)
    expect(isFasta('db.txt')).toBe(false)
  })
})

it('a Bruker analysis.tdf stands for its .d folder', () => {
  expect(brukerFolder('/data/run.d/analysis.tdf')).toBe('/data/run.d')
  expect(brukerFolder('C:\\data\\run.d\\analysis.tdf_bin')).toBe('C:\\data\\run.d')
  expect(brukerFolder('/data/run.mzML')).toBe('/data/run.mzML')
})
