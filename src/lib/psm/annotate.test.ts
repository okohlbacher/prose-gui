/// <reference types="node" />
// The fragment annotation against the web app: fixtures/annotations.json is the web app's annotatePeaks
// (its 32-bit WebAssembly module, scripts/annotation-golden.mjs) of PSMs of the results reader's
// fixtures (read here with readSearch, as the app reads them), of spectra made for the tie rules (in
// the file) and of edge cases, with the option sets of the PSM view and others. And against ProSE's own
// fragment annotation of its scoring (QPX ion_type_array).

import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { parquetReadObjects } from 'hyparquet'
import { describe, expect, test } from 'vitest'
import { FileNotFound, readSearch, type SearchResult } from '../results/read'
import type { PeakAnnotationResult } from '../results/types'
import { annotatePeaks, type AnnotationOptions } from './annotate'

const results = new URL('../results/fixtures/', import.meta.url).pathname

/** The search folder of the reader's fixture `name`, as the `files` contract has it. */
function folder(name: string) {
  const dir = join(results, name)
  return async (file: string): Promise<Uint8Array> => {
    const path = file.startsWith('/') ? join(dir, 'user', basename(file)) : join(dir, file)
    try {
      return new Uint8Array(readFileSync(path))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new FileNotFound(file)
      throw e
    }
  }
}

const searches = new Map<string, Promise<SearchResult>>()
const search = (name: string) => {
  if (!searches.has(name)) searches.set(name, readSearch(folder(name)))
  return searches.get(name)!
}

/** The stored peaks of PSM `row` (views of the stored arrays, as the PSM view passes them). */
function psmPeaks(r: SearchResult, row: number): { mz: Float32Array; intensity: Float32Array } {
  const s = r.spectra.psmSpectrum[row]
  expect(s, `row ${row} has a spectrum`).toBeGreaterThanOrEqual(0)
  const [from, to] = [r.spectra.offsets[s], r.spectra.offsets[s + 1]]
  return { mz: r.spectra.mz.subarray(from, to), intensity: r.spectra.intensity.subarray(from, to) }
}

type Match = [number, string, string, number, number, string, number, number]
type Ion = [string, string, number, number, number]
type GoldenCase = {
  name: string
  spectrum: { fixture: string; row: number; peaks: number } | { embedded: number; peaks: number }
  peptide: string
  charge: number
  options: AnnotationOptions
  result: { matches: Match[]; theoretical: Ion[] } | { error: string }
}
type Golden = { module: string; spectra: { mz: number[]; intensity: number[]; float64?: boolean }[]; cases: GoldenCase[] }

const golden: Golden = JSON.parse(readFileSync(new URL('./fixtures/annotations.json', import.meta.url), 'utf8'))

/** The annotation as the golden file's tuples. */
const tuples = (r: PeakAnnotationResult) => ({
  matches: r.matches.map((m): Match => [m.peak, m.ion, m.type, m.ordinal, m.charge, m.loss, m.theoreticalMz, m.errorPpm]),
  theoretical: r.theoretical.map((t): Ion => [t.ion, t.type, t.ordinal, t.charge, t.mz]),
})

/** The first difference of two lists of tuples, or null. */
function firstDifference<T extends unknown[]>(label: string, actual: T[], expected: T[]): string | null {
  for (let i = 0; i < Math.max(actual.length, expected.length); i++) {
    if (JSON.stringify(actual[i]) !== JSON.stringify(expected[i])) {
      return `${label}[${i}] of ${expected.length}: ${JSON.stringify(actual[i])}, expected ${JSON.stringify(expected[i])}`
    }
  }
  return null
}

describe('annotatePeaks', () => {
  test("equals the web module's annotatePeaks", { timeout: 60_000 }, async () => {
    expect(golden.cases.length).toBeGreaterThan(200)
    const psms = new Set(golden.cases.flatMap((c) => ('fixture' in c.spectrum && c.spectrum.fixture === 'example' ? [c.spectrum.row] : [])))
    expect(psms.size).toBeGreaterThanOrEqual(50)

    const failures: string[] = []
    let compared = 0
    for (const c of golden.cases) {
      let mz: ArrayLike<number>
      let intensity: ArrayLike<number>
      if ('fixture' in c.spectrum) {
        const r = await search(c.spectrum.fixture)
        ;({ mz, intensity } = psmPeaks(r, c.spectrum.row))
        expect(mz.length, `${c.name}: the PSM's peaks`).toBe(c.spectrum.peaks)
        // the PSM's own peptide and charge (the variants change the peptide)
        if (/^(example|mods) \d+ (options|precursor)/.test(c.name)) {
          expect(r.tables.peptides.openms[r.tables.psms.peptide[c.spectrum.row]], `${c.name}: peptide`).toBe(c.peptide)
        }
      } else {
        // float32 as stored, or doubles (plain arrays) where the case is about float precision
        const s = golden.spectra[c.spectrum.embedded]
        mz = s.float64 ? s.mz : new Float32Array(s.mz)
        intensity = s.float64 ? s.intensity : new Float32Array(s.intensity)
        expect(mz.length).toBe(c.spectrum.peaks)
      }

      const expected = c.result
      if ('error' in expected) {
        expect(() => annotatePeaks(mz, intensity, c.peptide, c.charge, c.options), `${c.name}: throws (${expected.error})`).toThrow()
        compared++
        continue
      }
      let actual: ReturnType<typeof tuples>
      try {
        actual = tuples(annotatePeaks(mz, intensity, c.peptide, c.charge, c.options))
      } catch (e) {
        failures.push(`${c.name} (${c.peptide}, ${JSON.stringify(c.options)}): throws ${String(e)}`)
        continue
      }
      const difference =
        firstDifference('theoretical', actual.theoretical, expected.theoretical) ?? firstDifference('matches', actual.matches, expected.matches)
      if (difference !== null) failures.push(`${c.name} (${c.peptide}, ${JSON.stringify(c.options)}): ${difference}`)
      compared++
    }
    expect(failures, `${failures.length} of ${golden.cases.length} cases differ:\n${failures.slice(0, 20).join('\n')}`).toEqual([])
    expect(compared).toBe(golden.cases.length)
  })

  test("agrees with ProSE's own annotations for b/y", { timeout: 60_000 }, async () => {
    // ProSE's annotation of its scoring: b and y ions of charges 1 to min(charge − 1, 2), the first prefix
    // ion included, no losses, matched with the search's fragment tolerance (20 ppm) by
    // SpectrumAlignment (ProSEAlgorithm, the PSM annotations), named 'b3+', 'y5++'; QPX mz_array has the
    // matched peaks' m/z
    const r = await search('example')
    const bytes = readFileSync(join(results, 'example/qpx/1__DatabaseSuitability_1.psm.parquet'))
    const file = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const rows = (await parquetReadObjects({
      file,
      columns: ['sequence', 'charge', 'mz_array', 'ion_type_array'],
      compressors: { ZSTD: (input: Uint8Array) => new Uint8Array(zstdDecompressSync(input)) },
    })) as { sequence: string; charge: number; mz_array: number[] | null; ion_type_array: string[] | null }[]
    // the PSM rows of the first input are its QPX rows, in order
    expect(rows.length).toBeGreaterThan(800)
    expect(r.tables.psms.file.filter((f) => f === 0).length).toBe(rows.length)

    // ProSE matches against the deisotoped spectrum (fragment:deisotope 'auto', on at 20 ppm): a peak
    // one 13C spacing (charge 1, as these fragments) above another, within the tolerance, is taken as
    // that peak's isotope and removed. Such a peak can carry one of our ions that ProSE's lacks; every
    // other ion is the same, on the same peak.
    const C13C12_MASSDIFF_U = 1.0033548378
    const isotopeOfAnother = (peaks: Float32Array, at: number) =>
      Array.from(peaks).some((p) => p < at && Math.abs(p + C13C12_MASSDIFF_U - at) <= 20e-6 * at)

    let ions = 0
    let same = 0
    let extra = 0
    const differences: string[] = []
    rows.forEach((q, row) => {
      const peptide = r.tables.peptides.openms[r.tables.psms.peptide[row]]
      expect(r.tables.peptides.sequence[r.tables.psms.peptide[row]]).toBe(q.sequence)
      const charge = r.tables.psms.charge[row]
      const { mz, intensity } = psmPeaks(r, row)
      const maxCharge = charge >= 2 ? Math.min(charge - 1, 2) : 1
      const ours = annotatePeaks(mz, intensity, peptide, charge, { tolerance: 20, unit: 'ppm', maxCharge, ions: ['b', 'y'] })
      const prose = (q.ion_type_array ?? []).map((name, k) => ({ ion: name.replace(/^([a-z]\d+)\+$/, '$1'), mz: Math.fround(q.mz_array![k]) }))
      const mine = ours.matches.map((m) => ({ ion: m.ion, mz: mz[m.peak] }))
      ions += prose.length
      if (JSON.stringify(mine) === JSON.stringify(prose)) {
        same++
        return
      }
      // ProSE's ions are ours, in order and on the same peaks; ours besides are on isotope peaks
      const rest = mine.filter((m) => !prose.some((p) => p.ion === m.ion))
      const shared = mine.filter((m) => prose.some((p) => p.ion === m.ion))
      if (JSON.stringify(shared) !== JSON.stringify(prose) || !rest.every((m) => isotopeOfAnother(mz, m.mz))) {
        differences.push(`row ${row} ${peptide}/${charge}: ${JSON.stringify(mine)}, ProSE ${JSON.stringify(prose)}`)
      }
      extra += rest.length
    })
    expect(ions).toBeGreaterThan(5000)
    expect(differences, `${differences.length} of ${rows.length} PSMs differ:\n${differences.slice(0, 10).join('\n')}`).toEqual([])
    // nearly all PSMs agree ion for ion
    expect(same).toBeGreaterThan(0.95 * rows.length)
    console.info(`ProSE's b/y annotation: ${same} of ${rows.length} PSMs the same, ${ions} ions; ${extra} ions more on isotope peaks of ${rows.length - same} PSMs`)
  })
})
