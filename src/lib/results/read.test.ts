/// <reference types="node" />
// The reader against the web app: each fixture (fixtures/<case>/) is a search of the pinned ProSE tool
// in a search folder as the shim makes it (scripts/results-fixture-native.mjs), and fixtures/web-<case>.json
// is the web app's result of the same search with its WebAssembly module (scripts/results-fixture-web.mjs).
// The cases are in scripts/results-example.mjs. Where the two legitimately differ, the test says why.

import { readFileSync } from 'node:fs'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { parquetMetadata, parquetReadObjects } from 'hyparquet'
import { parquetWriteBuffer } from 'hyparquet-writer'
import { describe, expect, test } from 'vitest'
import { FileNotFound, readSearch, ZSTD } from './read'
import type { ProSEMultiSummary, ResultTables, StoredSpectra } from './types'

const fixtures = new URL('./fixtures/', import.meta.url).pathname

/**
 * The files of a search folder, as the `files` contract has it (a missing file: FileNotFound); an
 * absolute path (the user's FASTA of a search without contaminants) is in user/.
 */
function folder(dir: string) {
  const asked: string[] = []
  const files = async (name: string): Promise<Uint8Array> => {
    asked.push(name)
    const path = name.startsWith('/') ? join(dir, 'user', basename(name)) : join(dir, name)
    try {
      return new Uint8Array(readFileSync(path))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new FileNotFound(name)
      throw e
    }
  }
  return { files, asked }
}

/** A copy of fixture `name` to change, removed after `use`. */
async function withCopy<T>(name: string, use: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), `prose-reader-${name}-`))
  try {
    cpSync(join(fixtures, name), dir, { recursive: true })
    return await use(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

type Json = Record<string, any>
type WebResult = { names: string[]; summary: ProSEMultiSummary; tables: Json; spectra: Json; predicted: Json }
const web = (name: string): WebResult => JSON.parse(readFileSync(join(fixtures, `web-${name}.json`), 'utf8'))

/** null (NaN in JSON) as NaN */
const num = (v: number | null) => (v === null ? NaN : v)

/** Every value of `actual` equals `expected` within `tolerance` (NaN only where NaN). */
function expectClose(label: string, actual: ArrayLike<number>, expected: ArrayLike<number | null>, tolerance: number) {
  expect(actual.length, `${label}: length`).toBe(expected.length)
  for (let i = 0; i < actual.length; i++) {
    const a = actual[i]
    const e = num(expected[i])
    if (Number.isNaN(e) || Number.isNaN(a)) {
      if (!(Number.isNaN(e) && Number.isNaN(a))) expect.fail(`${label}[${i}]: ${a}, expected ${e}`)
      continue
    }
    if (!(Math.abs(a - e) <= tolerance)) expect.fail(`${label}[${i}]: ${a}, expected ${e} (±${tolerance})`)
  }
}

/** As expectClose, relative to the expected value. */
function expectRelative(label: string, actual: number, expected: number, tolerance: number) {
  if (!(Math.abs(actual - expected) <= tolerance * Math.max(1e-300, Math.abs(expected)))) {
    expect.fail(`${label}: ${actual}, expected ${expected} (±${tolerance} relative)`)
  }
}

const PEPTDEEP_FEATURES = ['ms2_cosine', 'ms2_spectral_angle', 'ms2_pearson', 'ms2_frac_pred_found', 'rt_abs_error']

/**
 * Percolator's scores of the example with PeptDeep differ from the web app's by up to 1.4e-4: PeptDeep's
 * features differ by up to 4e-7 (ONNX Runtime, native and WebAssembly) and Percolator's training
 * carries that into its SVM. Without PeptDeep the scores agree within 4e-9 (task 4 report).
 */
const PEPTDEEP_SCORE_TOLERANCE = 2e-4

interface Tolerances {
  score: number
  /** 'differs': the PEPs are known to differ (the example: test below) */
  pep?: 'differs'
}

/** ResultTables equal the web app's: strings exactly, numbers within the tolerances. */
function expectTables(t: ResultTables, w: Json, names: string[], tol: Tolerances) {
  expect(t.files.map((f) => basename(f))).toEqual(names)
  const p = t.psms
  const wp = w.psms
  expect(p.count).toBe(wp.count)
  expect(Array.from(p.file)).toEqual(wp.file)
  expect(p.nativeId).toEqual(wp.nativeId)
  expect(Array.from(p.charge)).toEqual(wp.charge)
  expect(Array.from(p.peptide)).toEqual(wp.peptide)
  expect(Array.from(p.decoy)).toEqual(wp.decoy)
  expect(Array.from(p.isotopeError)).toEqual(wp.isotopeError)
  expectClose('psms.rt', p.rt, wp.rt, 1e-9)
  expectClose('psms.mz', p.mz, wp.mz, 1e-9)
  expectClose('psms.score', p.score, wp.score, tol.score)
  expectClose('psms.qValue', p.qValue, wp.qValue, 1e-6)
  if (tol.pep !== 'differs') expectClose('psms.pep', p.pep, wp.pep, 1e-6)
  expectClose('psms.precursorErrorPpm', p.precursorErrorPpm, wp.precursorErrorPpm, 1e-6)
  expectClose('psms.deltaMass', p.deltaMass, wp.deltaMass, 1e-6)

  expect(p.featureNames).toEqual(wp.featureNames)
  const n = p.featureNames.length
  expect(p.features.length).toBe(p.count * n)
  p.featureNames.forEach((name, j) => {
    const column = (f: ArrayLike<number | null>) => Array.from({ length: p.count }, (_, i) => num(f[i * n + j]))
    expectClose(`feature ${name}`, column(p.features), column(wp.features), PEPTDEEP_FEATURES.includes(name) ? 1e-5 : 1e-6)
  })

  const pt = t.peptides
  const wt = w.peptides
  expect(pt.count).toBe(wt.count)
  expect(pt.openms).toEqual(wt.openms)
  expect(pt.proforma).toEqual(wt.proforma)
  expect(pt.sequence).toEqual(wt.sequence)
  expect(Array.from(pt.decoy)).toEqual(wt.decoy)
  expect(Array.from(pt.modOffsets)).toEqual(wt.modOffsets)
  expect(Array.from(pt.modPosition)).toEqual(wt.modPosition)
  expect(pt.modName).toEqual(wt.modName)
  expect(Array.from(pt.modUnimod)).toEqual(wt.modUnimod)
  expectClose('peptides.modMass', pt.modMass, wt.modMass, 1e-6)
  expect(Array.from(pt.proteinOffsets)).toEqual(wt.proteinOffsets)
  // proteins by accession: the order of the protein rows may differ (below)
  expect(Array.from(pt.protein, (r) => t.proteins.accession[r])).toEqual(wt.protein.map((r: number) => w.proteins.accession[r]))
  expect(Array.from(pt.start)).toEqual(wt.start)
  expect(Array.from(pt.end)).toEqual(wt.end)

  // Proteins: the same rows in another order. The native tool writes the protein hits of the pooled
  // run in the order of the merged idXML, the web app in the order of its result set; both come from
  // hashed containers. Compared by accession, groups as sets of accessions.
  const r = t.proteins
  const wr = w.proteins
  expect(r.count).toBe(wr.count)
  expect([...r.accession].sort()).toEqual([...wr.accession].sort())
  const groupOf = (accession: string[], group: ArrayLike<number>) => {
    const members = new Map<number, string[]>()
    accession.forEach((a, i) => members.set(group[i], [...(members.get(group[i]) ?? []), a]))
    return new Map(accession.map((a, i) => [a, group[i] < 0 ? '' : members.get(group[i])!.sort().join(' ')]))
  }
  const groups = groupOf(r.accession, r.group)
  const webGroups = groupOf(wr.accession, wr.group)
  r.accession.forEach((accession, i) => {
    const k = wr.accession.indexOf(accession)
    expect(r.description[i], `description of ${accession}`).toBe(wr.description[k])
    expect(r.sequence[i], `sequence of ${accession}`).toBe(wr.sequence[k])
    expect(r.decoy[i], `decoy ${accession}`).toBe(wr.decoy[k])
    expectClose(`proteins.score ${accession}`, [r.score[i]], [wr.score[k]], tol.score)
    expectClose(`proteins.qValue ${accession}`, [r.qValue[i]], [wr.qValue[k]], 1e-6)
    expect(groups.get(accession), `group of ${accession}`).toBe(webGroups.get(accession))
  })
}

/** ProSEMultiSummary equals the web app's, but for the times and the paths (the app's: the user's files). */
function expectSummary(s: ProSEMultiSummary, w: ProSEMultiSummary) {
  expect(s.files.map((f) => basename(f.path))).toEqual(w.files.map((f) => basename(f.path)))
  s.files.forEach((f, i) => {
    const e = w.files[i]
    expect({ ...f, path: '', secondsSearch: 0, precursorError: null, fragmentError: null }).toEqual({
      ...e,
      path: '',
      secondsSearch: 0,
      precursorError: null,
      fragmentError: null,
    })
    expect(f.secondsSearch).toBeGreaterThanOrEqual(0)
    // summary.yaml has six significant digits
    for (const key of ['precursorError', 'fragmentError'] as const) {
      const [a, b] = [f[key], e[key]]
      expect(a === null, key).toBe(b === null)
      if (a && b) for (const k of ['median', 'mad', 'recommended'] as const) expectRelative(`${key}.${k}`, a[k], b[k], 1e-5)
    }
  })
  const { secondsIndexBuild, secondsTotal, databaseFile, ...search } = s.search
  const { secondsIndexBuild: _b, secondsTotal: _t, databaseFile: webDatabase, ...webSearch } = w.search
  expect(search).toEqual(webSearch)
  expect(secondsIndexBuild).toBeGreaterThanOrEqual(0)
  expect(secondsTotal).toBeGreaterThan(0)
  expect(databaseFile).not.toBe('')
  expect(webDatabase).not.toBe('')
  expect({ ...s, files: [], search: null, modificationAnalysis: null }).toEqual({ ...w, files: [], search: null, modificationAnalysis: null })
}

describe('readSearch', () => {
  test('the example reads as the web app\'s result', async () => {
    const w = web('example')
    const { files, asked } = folder(join(fixtures, 'example'))
    const { summary, tables } = await readSearch(files)

    // the counts of the example with PeptDeep: 1,790 target PSMs at 1 % (895 of each replicate)
    expect(tables.psms.count).toBe(1792)
    const targets = Array.from(tables.psms.qValue).filter((q, i) => q <= 0.01 && tables.psms.decoy[i] === 0)
    expect(targets.length).toBe(1790)
    expect(tables.files).toEqual(['/data/DatabaseSuitability_1.mzML', '/data/DatabaseSuitability_2.mzML'])

    expectTables(tables, w.tables, w.names, { score: PEPTDEEP_SCORE_TOLERANCE, pep: 'differs' })
    expectSummary(summary, w.summary)
    expect(summary.files.map((f) => f.path)).toEqual(tables.files)
    // only relative names: the folder's files, and its database with the contaminants
    expect(asked.filter((n) => n.startsWith('/'))).toEqual([])
    expect(asked).toContain('database.fasta')
  })

  test('the PEP of the example differs from the web app\'s (Percolator, one decoy per file)', async () => {
    // A known difference, not of the reader: with a single decoy PSM per file Percolator's PEP
    // estimate is degenerate, and ~1e-7 differences of the features decide between two outcomes: the
    // native tool gives every PSM of the example PEP 1, the web app small PEPs (and without PeptDeep
    // the other way round). The reader passes on ProSE's QPX posterior_error_probability.
    const w = web('example')
    const { tables } = await readSearch(folder(join(fixtures, 'example')).files)
    expect(Array.from(tables.psms.pep).every((p) => p === 1)).toBe(true)
    expect(w.tables.psms.pep.filter((p: number) => p === 1).length).toBe(0)
  })

  test('modified peptides read as the web app\'s', async () => {
    const w = web('mods')
    const { files, asked } = folder(join(fixtures, 'mods'))
    const { summary, tables } = await readSearch(files)
    expect(tables.peptides.openms).toContain('IALSRPNVEVVALNDPFITNDYAAYM(Oxidation)FK')
    expectTables(tables, w.tables, w.names, { score: 1e-6 })
    expectSummary(summary, w.summary)
    // without contaminants the search read the user's FASTA, named in summary.yaml
    expect(asked.filter((n) => n.startsWith('/')).map((n) => basename(n))).toEqual(['SimpleSearchEngine_1.fasta'])
  })

  test('an open search reads as the web app\'s', async () => {
    const w = web('open')
    const { summary, tables } = await readSearch(folder(join(fixtures, 'open')).files)
    expectTables(tables, w.tables, w.names, { score: 1e-6 })
    expectSummary(summary, w.summary)
    expect(Array.from(tables.psms.deltaMass).some((d) => d > 15)).toBe(true)

    // the modification analysis: the TSVs have six significant digits; their PTM table has no charge
    // states (0, which the web app's screens do not show)
    const m = summary.modificationAnalysis!
    const e = w.summary.modificationAnalysis!
    expect(m).not.toBeNull()
    const { entries: deltas, ...deltaTotals } = m.deltaMasses
    const { entries: webDeltas, ...webDeltaTotals } = e.deltaMasses
    for (const [k, v] of Object.entries(webDeltaTotals)) expectRelative(`deltaMasses.${k}`, deltaTotals[k as keyof typeof deltaTotals], v, 1e-5)
    expect(deltas.length).toBe(webDeltas.length)
    deltas.forEach((d, i) => {
      expect({ ...d, deltaMass: 0, percentage: 0 }).toEqual({ ...webDeltas[i], deltaMass: 0, percentage: 0 })
      expectRelative('deltaMass', d.deltaMass, webDeltas[i].deltaMass, 1e-5)
      expectRelative('percentage', d.percentage, webDeltas[i].percentage, 1e-5)
    })
    const { entries: ptms, ...ptmTotals } = m.ptms
    const { entries: webPtms, ...webPtmTotals } = e.ptms
    expect(ptmTotals).toEqual(webPtmTotals)
    expect(ptms.length).toBe(webPtms.length)
    ptms.forEach((p, i) => {
      const q = webPtms[i]
      expect(p.chargeStates).toBe(0)
      expect({ ...p, theoreticalMass: 0, observedMass: 0, massDeviation: 0, percentage: 0, chargeStates: 0 }).toEqual({
        ...q,
        theoreticalMass: 0,
        observedMass: 0,
        massDeviation: 0,
        percentage: 0,
        chargeStates: 0,
      })
      for (const k of ['theoreticalMass', 'observedMass', 'massDeviation', 'percentage'] as const) expectRelative(k, p[k], q[k], 1e-5)
    })
  })
})

/** The peaks of spectrum `s`. */
const peaks = (sp: StoredSpectra | Json, s: number) => {
  const [from, to] = [sp.offsets[s], sp.offsets[s + 1]]
  // (float32 values: the web app's export has them with the 9 digits that keep them)
  const float32 = (a: ArrayLike<number>) => Array.from(a, Math.fround)
  return { mz: float32(sp.mz.slice(from, to)), intensity: float32(sp.intensity.slice(from, to)) }
}

describe('peaks and predictions belong to their PSM', () => {
  test('the peaks and the precursor of each PSM are the web app\'s', async () => {
    const w = web('example')
    const { spectra, tables } = await readSearch(folder(join(fixtures, 'example')).files)
    expect(spectra.psmSpectrum.length).toBe(tables.psms.count)
    for (let i = 0; i < tables.psms.count; i++) {
      const s = spectra.psmSpectrum[i]
      const ws = w.spectra.psmSpectrum[i]
      expect(s >= 0, `row ${i} has peaks`).toBe(ws >= 0)
      expect(peaks(spectra, s), `peaks of row ${i}`).toEqual(peaks(w.spectra, ws))
      expectClose(`precursorMz of row ${i}`, [spectra.precursorMz[s]], [w.spectra.precursorMz[ws]], 1e-9)
    }
    // the collision energy is not read (docs/parity.md: the predictions are ProSE's)
    expect(Array.from(spectra.collisionEnergy).every(Number.isNaN)).toBe(true)
  })

  test('the predictions of each PSM are the web app\'s predictMS2 of its peptide', async () => {
    const w = web('example')
    const { predicted, tables } = await readSearch(folder(join(fixtures, 'example')).files)
    const wp = w.predicted
    expect(predicted.psmOffsets.length).toBe(tables.psms.count + 1)
    for (let i = 0; i < tables.psms.count; i++) {
      const [from, to] = [predicted.psmOffsets[i], predicted.psmOffsets[i + 1]]
      const [wf, wt] = [wp.psmOffsets[i], wp.psmOffsets[i + 1]]
      expect(to - from, `row ${i} has a prediction`).toBeGreaterThan(0)
      expect(predicted.ion.slice(from, to), `ions of row ${i}`).toEqual(wp.ion.slice(wf, wt))
      expectClose(`m/z of row ${i}`, predicted.mz.slice(from, to), wp.mz.slice(wf, wt), 1e-3)
      expectClose(`intensity of row ${i}`, predicted.intensity.slice(from, to), wp.intensity.slice(wf, wt), 1e-5)
    }
  })

  test('rows are joined by psm_id, not by position', async () => {
    // the sidecar written in reverse order: every PSM keeps its own peaks and prediction
    const dir = mkdtempSync(join(tmpdir(), 'prose-reader-'))
    try {
      cpSync(join(fixtures, 'example'), dir, { recursive: true })
      for (const stem of ['1__DatabaseSuitability_1', '2__DatabaseSuitability_2']) {
        const path = join(dir, 'spectra', `${stem}.psm_spectra.parquet`)
        writeFileSync(path, await reversed(new Uint8Array(readFileSync(path))))
      }
      const original = await readSearch(folder(join(fixtures, 'example')).files)
      const shuffled = await readSearch(folder(dir).files)
      for (let i = 0; i < original.tables.psms.count; i++) {
        expect(peaks(shuffled.spectra, shuffled.spectra.psmSpectrum[i])).toEqual(peaks(original.spectra, original.spectra.psmSpectrum[i]))
        const ions = (p: typeof original.predicted) => p.ion.slice(p.psmOffsets[i], p.psmOffsets[i + 1])
        expect(ions(shuffled.predicted)).toEqual(ions(original.predicted))
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/** The top-level column names of a Parquet file's schema. */
function topColumns(metadata: ReturnType<typeof parquetMetadata>): string[] {
  const names: string[] = []
  const skip = (i: number): number => {
    let next = i + 1
    for (let k = 0; k < (metadata.schema[i].num_children ?? 0); k++) next = skip(next)
    return next
  }
  for (let k = 0, i = 1; k < (metadata.schema[0].num_children ?? 0); k++) {
    names.push(metadata.schema[i].name)
    i = skip(i)
  }
  return names
}

/** A Parquet file with `rows` in the schema of `bytes` (hyparquet-writer, Zstandard as ProSE's: Node's zlib). */
function rewrite(bytes: Uint8Array, rows: Record<string, unknown>[], extraMetadata = true): Uint8Array {
  const metadata = parquetMetadata(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  const columnData = topColumns(metadata).map((name) => ({ name, data: rows.map((r) => r[name]) as never[] }))
  return new Uint8Array(
    parquetWriteBuffer({
      columnData,
      schema: metadata.schema,
      rowGroupSize: 100_000,
      codec: 'ZSTD',
      compressors: { ZSTD: (input: Uint8Array) => new Uint8Array(zstdCompressSync(input)) },
      kvMetadata: extraMetadata ? metadata.key_value_metadata : undefined,
    }),
  )
}

async function rowsOf(bytes: Uint8Array): Promise<Record<string, unknown>[]> {
  const file = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return parquetReadObjects({ file, compressors: { ZSTD } })
}

async function reversed(bytes: Uint8Array): Promise<Uint8Array> {
  return rewrite(bytes, (await rowsOf(bytes)).reverse())
}

describe('missing and broken files', () => {
  const example = ['1__DatabaseSuitability_1', '2__DatabaseSuitability_2']

  test('a corrupt Parquet file fails the read, naming the file', async () => {
    await withCopy('example', async (dir) => {
      const path = join(dir, 'oms', `${example[0]}.psm.parquet`)
      const bytes = readFileSync(path)
      writeFileSync(path, bytes.subarray(0, bytes.length >> 1))
      await expect(readSearch(folder(dir).files)).rejects.toThrow(`oms/${example[0]}.psm.parquet:`)
    })
  })

  test('an error of the files callback other than not found fails the read, naming the file', async () => {
    const { files } = folder(join(fixtures, 'example'))
    const failing = (name: string) => (name.startsWith('spectra/') ? Promise.reject(new Error('permission denied')) : files(name))
    await expect(readSearch(failing)).rejects.toThrow(`spectra/${example[0]}.psm_spectra.parquet: permission denied`)
  })

  test('one of the two PSM files of an input alone fails the read', async () => {
    await withCopy('example', async (dir) => {
      rmSync(join(dir, 'qpx', `${example[1]}.psm.parquet`))
      await expect(readSearch(folder(dir).files)).rejects.toThrow(
        `qpx/${example[1]}.psm.parquet does not exist, but oms/${example[1]}.psm.parquet does.`,
      )
    })
  })

  test('an input without PSM files (a failed search) has no PSMs', async () => {
    await withCopy('example', async (dir) => {
      for (const f of [`qpx/${example[1]}.psm.parquet`, `oms/${example[1]}.psm.parquet`, `spectra/${example[1]}.psm_spectra.parquet`]) rmSync(join(dir, f))
      const { tables } = await readSearch(folder(dir).files)
      expect(tables.psms.count).toBe(896)
      expect(Array.from(tables.psms.file).every((f) => f === 0)).toBe(true)
    })
  })

  test('an empty result (no PSMs, no proteins) reads', async () => {
    await withCopy('mods', async (dir) => {
      const stem = '1__SimpleSearchEngine_1'
      for (const f of [`qpx/${stem}.psm.parquet`, `oms/${stem}.psm.parquet`, `spectra/${stem}.psm_spectra.parquet`, `oms/${stem}.proteins.parquet`, `oms/${stem}.pg.parquet`]) {
        const path = join(dir, f)
        writeFileSync(path, rewrite(new Uint8Array(readFileSync(path)), []))
      }
      const { tables, spectra, predicted, summary, warnings } = await readSearch(folder(dir).files)
      expect(tables.psms.count).toBe(0)
      expect(tables.peptides.count).toBe(0)
      expect(tables.proteins.count).toBe(0)
      expect(tables.psms.featureNames).toEqual(['ln(hyperscore)'])
      expect(Array.from(tables.peptides.modOffsets)).toEqual([0])
      expect(spectra.psmSpectrum.length).toBe(0)
      expect(Array.from(spectra.offsets)).toEqual([0])
      expect(Array.from(predicted.psmOffsets)).toEqual([0])
      expect(summary.files.length).toBe(1)
      expect(warnings).toEqual([])
    })
  })

  test("ProSE's output of a search in which no PSM passes the FDR reads as an empty result", async () => {
    // fixtures/empty: two inputs with the protein FDR and Percolator, the files as ProSE writes them (header only)
    const { tables, spectra, predicted, summary, warnings } = await readSearch(folder(join(fixtures, 'empty')).files)
    expect(tables.files).toEqual(['/data/DatabaseSuitability_1.mzML', '/data/DatabaseSuitability_2.mzML'])
    expect(tables.psms.count).toBe(0)
    expect(tables.peptides.count).toBe(0)
    expect(tables.proteins.count).toBe(0)
    expect(Array.from(tables.peptides.modOffsets)).toEqual([0])
    expect(Array.from(tables.peptides.proteinOffsets)).toEqual([0])
    expect(spectra.psmSpectrum.length).toBe(0)
    expect(Array.from(spectra.offsets)).toEqual([0])
    expect(Array.from(predicted.psmOffsets)).toEqual([0])
    expect(summary.files.map((f) => [f.status, f.ms2Spectra, f.targetPSMs, f.decoyPSMs])).toEqual([
      ['EXECUTION_OK', 2789, 0, 0],
      ['EXECUTION_OK', 2789, 0, 0],
    ])
    expect(summary.proteinFdrApplied).toBe(false)
    expect(warnings).toEqual([])
  })

  test('an open search without its mod-analysis folder reads, without the analysis', async () => {
    await withCopy('open', async (dir) => {
      rmSync(join(dir, 'mods'), { recursive: true })
      const { summary, tables } = await readSearch(folder(dir).files)
      expect(summary.openSearch).toBe(true)
      expect(summary.modificationAnalysis).toBeNull()
      expect(tables.psms.count).toBe(3)
    })
  })

  test('one input reads its own proteins and groups, without merged files', async () => {
    await withCopy('example', async (dir) => {
      // the example as a search of its first replicate only
      const inputs = JSON.parse(readFileSync(join(dir, 'inputs.json'), 'utf8')).slice(0, 1)
      writeFileSync(join(dir, 'inputs.json'), JSON.stringify(inputs))
      const yaml = readFileSync(join(dir, 'summary.yaml'), 'utf8')
      const [head, rest] = yaml.split('per_file:\n')
      const second = rest.indexOf('  - input_file: "2__')
      writeFileSync(join(dir, 'summary.yaml'), `${head}per_file:\n${rest.slice(0, second)}${rest.slice(rest.indexOf('outputs:'))}`)
      for (const f of ['oms/merged.proteins.parquet', 'oms/merged.pg.parquet']) rmSync(join(dir, f))
      const { files, asked } = folder(dir)
      const { tables, summary } = await readSearch(files)
      expect(tables.psms.count).toBe(896)
      expect(summary.files.length).toBe(1)
      expect(asked.some((n) => n.includes('merged'))).toBe(false)
      expect(asked).toContain(`oms/${example[0]}.proteins.parquet`)
      expect(tables.proteins.count).toBe(50)
      // the file's run has no protein groups: each protein is its own
      expect(Array.from(tables.proteins.group)).toEqual(Array.from({ length: 50 }, (_, p) => p))
    })
  })
})

describe('protein sequences', () => {
  test('come from proteins.fasta first', async () => {
    const w = web('mods')
    await withCopy('mods', async (dir) => {
      // the identified proteins only, in place of the database
      cpSync(join(dir, 'user', 'SimpleSearchEngine_1.fasta'), join(dir, 'proteins.fasta'))
      rmSync(join(dir, 'user'), { recursive: true })
      const { files, asked } = folder(dir)
      const { tables, warnings } = await readSearch(files)
      expect(asked.filter((n) => n.endsWith('.fasta'))).toEqual(['proteins.fasta'])
      expectTables(tables, w.tables, w.names, { score: 1e-6 })
      expect(warnings).toEqual([])
    })
  })

  test('then from the database: the folder\'s database.fasta, else the user\'s FASTA', async () => {
    const example = folder(join(fixtures, 'example'))
    await readSearch(example.files)
    expect(example.asked.filter((n) => n.endsWith('.fasta'))).toEqual(['proteins.fasta', 'database.fasta'])
    const mods = folder(join(fixtures, 'mods'))
    await readSearch(mods.files)
    expect(mods.asked.filter((n) => n.endsWith('.fasta')).map((n) => basename(n))).toEqual([
      'proteins.fasta',
      'database.fasta',
      'SimpleSearchEngine_1.fasta',
    ])
  })

  test('are left out with a warning when there is no FASTA', async () => {
    await withCopy('mods', async (dir) => {
      rmSync(join(dir, 'user'), { recursive: true })
      const { tables, warnings } = await readSearch(folder(dir).files)
      expect(tables.proteins.count).toBe(3)
      expect(tables.proteins.sequence).toEqual(['', '', ''])
      // the OMS descriptions (none in this search)
      expect(tables.proteins.description).toEqual(['', '', ''])
      // the peptides keep the positions the search recorded
      expect(Array.from(tables.peptides.end)).toEqual(web('mods').tables.peptides.end)
      expect(warnings.length).toBe(1)
      expect(warnings[0]).toMatch(/protein sequences are not available.*proteins\.fasta \(not found\).*database\.fasta \(not found\).*SimpleSearchEngine_1\.fasta \(not found\)/)
    })
  })
})

describe('performance', () => {
  test('reads a 150k-PSM fixture in under 3 s', async () => {
    // One input of 150,000 PSMs: the rows of the example's first file, repeated, each with its own
    // psm_id, in the schemas of the tool's files (QPX psm, OMS psm, PSM spectra sidecar).
    const N = 150_000
    const source = join(fixtures, 'example')
    const dir = mkdtempSync(join(tmpdir(), 'prose-reader-150k-'))
    try {
      const stem = '1__DatabaseSuitability_1'
      const read = (p: string) => new Uint8Array(readFileSync(join(source, p)))
      const qpx = await rowsOf(read(`qpx/${stem}.psm.parquet`))
      const oms = await rowsOf(read(`oms/${stem}.psm.parquet`))
      const sidecar = await rowsOf(read(`spectra/${stem}.psm_spectra.parquet`))
      const id = (i: number) => BigInt(i + 1) * 7919n
      const many = <T extends Record<string, unknown>>(rows: T[], each: (row: T, i: number) => T) =>
        Array.from({ length: N }, (_, i) => each(rows[i % rows.length], i))
      for (const sub of ['qpx', 'oms', 'spectra']) mkdirSync(join(dir, sub))
      writeFileSync(join(dir, `qpx/${stem}.psm.parquet`), rewrite(read(`qpx/${stem}.psm.parquet`), many(qpx, (r, i) => ({ ...r, psm_id: id(i) }))))
      // the meta values of every row its own (as in a real search, where they are hardly ever repeated:
      // Arrow writes them without a dictionary)
      type Meta = { name: string; value: string; value_type: string }
      const distinct = (r: Record<string, unknown>, i: number) => ({
        ...r,
        psm_metavalues: (r.psm_metavalues as Meta[]).map((m) =>
          m.value_type === 'double' ? { ...m, value: String(Number(m.value) + i * 1e-9) } : m,
        ),
      })
      writeFileSync(join(dir, `oms/${stem}.psm.parquet`), rewrite(read(`oms/${stem}.psm.parquet`), many(oms, distinct)))
      writeFileSync(
        join(dir, `spectra/${stem}.psm_spectra.parquet`),
        rewrite(read(`spectra/${stem}.psm_spectra.parquet`), many(sidecar, (r, i) => ({ ...r, psm_id: id(i) }))),
      )
      for (const f of [`oms/${stem}.search_params.parquet`, `oms/${stem}.proteins.parquet`, `oms/${stem}.pg.parquet`, 'database.fasta']) {
        cpSync(join(source, f), join(dir, f))
      }
      const inputs = JSON.parse(readFileSync(join(source, 'inputs.json'), 'utf8')).slice(0, 1)
      writeFileSync(join(dir, 'inputs.json'), JSON.stringify(inputs))
      // the summary of one file
      const yaml = readFileSync(join(source, 'summary.yaml'), 'utf8')
      const [head, rest] = yaml.split('per_file:\n')
      const second = rest.indexOf('  - input_file: "2__')
      const tail = rest.slice(rest.indexOf('outputs:'))
      writeFileSync(join(dir, 'summary.yaml'), `${head}per_file:\n${rest.slice(0, second)}${tail}`.replace('protein_fdr_applied: true', 'protein_fdr_applied: false'))

      const files = folder(dir).files
      const started = performance.now()
      const { tables, spectra, predicted } = await readSearch(files)
      const seconds = (performance.now() - started) / 1000
      console.log(`150k PSMs read in ${seconds.toFixed(2)} s`)
      expect(tables.psms.count).toBe(N)
      expect(spectra.psmSpectrum[N - 1]).toBe(N - 1)
      expect(predicted.psmOffsets.length).toBe(N + 1)
      expect(seconds).toBeLessThan(3)
    } finally {
      if (process.env.KEEP_150K) cpSync(dir, process.env.KEEP_150K, { recursive: true })
      rmSync(dir, { recursive: true, force: true })
    }
  }, 300_000)
})
