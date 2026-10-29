// The test oracle: a fixture's QPX files (src/lib/results/fixtures/<name>/qpx) read here, in Node, with hyparquet's
// own object reader and fzstd, independently of the app's reader (src/lib/results/read.ts, parquet.ts, which decode
// the columns themselves), and the numbers the screens should show recomputed from them by the definitions the
// screens state (the key figures' tooltips, the tables' headers, Help). Nothing here imports the app's code.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parquetReadObjects } from 'hyparquet'
import { decompress } from 'fzstd'

/** The cutoffs the dev hook opens every fixture with (src/lib/dev/fixture.ts: psmFdr 0.02, proteinFdr 0.01). */
export const FIXTURE_PSM_FDR = 0.02
export const FIXTURE_PROTEIN_FDR = 0.01

const fixtures = fileURLToPath(new URL('../../src/lib/results/fixtures/', import.meta.url))
const compressors = { ZSTD: (input: Uint8Array, length: number) => decompress(input, new Uint8Array(length)) }

type Row = Record<string, unknown>

async function rows(path: string): Promise<Row[]> {
  const bytes = readFileSync(path)
  const file = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return (await parquetReadObjects({ file, compressors })) as Row[]
}

const num = (v: unknown): number => (v === null || v === undefined ? NaN : typeof v === 'bigint' ? Number(v) : Number(v))

export interface OraclePsm {
  /** the row in quantms.psm.parquet */
  row: number
  /** the input (0-based, in the order of the run view) */
  run: number
  sequence: string
  /** QPX peptidoform (ProForma with UNIMOD accessions): the identity of a peptide form */
  peptidoform: string
  charge: number
  decoy: boolean
  /** global q-value (Percolator's, if rescored); NaN: none */
  q: number
  /** Percolator's score if rescored, else ln(hyperscore) */
  score: number
  /** the precursor error ProSE reports (ppm); NaN: none */
  ppm: number
  /** the precursor error recomputed from the m/z columns and the isotope error (ppm) */
  ppmFromMasses: number
  observedMz: number
  calculatedMz: number
  nativeId: string
  scan: number
  /** 1-based positions; name as QPX has it */
  mods: { name: string; accession: string; positions: number[] }[]
  /** protein_mappings: 1-based first and last residue */
  proteins: { accession: string; start: number; end: number }[]
}

export interface OracleRun {
  stem: string
  ms2: number
  psmRows: number
  rescored: boolean
  precursor: { median: number; mad: number; recommended: number } | null
  fragment: { median: number; mad: number; recommended: number } | null
}

export interface OracleGroup {
  accessions: string[]
  decoy: boolean
  /** the q-value of the group (its additional score 'q-value', else global_qvalue); NaN: none */
  q: number
}

export interface Fixture {
  name: string
  psms: OraclePsm[]
  runs: OracleRun[]
  groups: OracleGroup[]
  /** the provenance's peptide_search parameters, and its tool version */
  search: Map<string, string>
  fdr: Map<string, string>
  toolVersion: string
  /** the FASTA (database.fasta of the folder), by identifier; sequences without trailing stop codons */
  fasta: Map<string, string>
  inputs: { name: string; stem: string }[]
}

const C13_C12 = 1.0033548378

function fastaOf(path: string): Map<string, string> {
  const out = new Map<string, string>()
  if (!existsSync(path)) return out
  let id: string | null = null
  let parts: string[] = []
  const flush = () => id !== null && !out.has(id) && out.set(id, parts.join('').replace(/\*+$/, ''))
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (line.startsWith('>')) {
      flush()
      id = line.slice(1).trim().split(/\s/)[0]
      parts = []
    } else if (line) parts.push(line)
  }
  flush()
  return out
}

const cache = new Map<string, Promise<Fixture>>()

/** The fixture `name`, read once per worker. */
export function loadFixture(name: string): Promise<Fixture> {
  let f = cache.get(name)
  if (!f) cache.set(name, (f = read(name)))
  return f
}

async function read(name: string): Promise<Fixture> {
  const dir = `${fixtures}${name}/`
  const inputs = JSON.parse(readFileSync(`${dir}inputs.json`, 'utf8')) as { name: string; stem: string; index: number }[]
  inputs.sort((a, b) => a.index - b.index)
  const runRows = await rows(`${dir}qpx/quantms.run.parquet`)
  const runs: OracleRun[] = runRows.map((r) => {
    const est = (k: string) =>
      Number.isNaN(num(r[`${k}_error_median_ppm`])) ? null : { median: num(r[`${k}_error_median_ppm`]), mad: num(r[`${k}_error_mad_ppm`]), recommended: num(r[`${k}_tolerance_recommended_ppm`]) }
    return {
      stem: String(r.run_file_name),
      ms2: num(r.ms2_spectra_count),
      psmRows: num(r.psm_rows),
      rescored: r.rescoring_applied === true,
      precursor: est('precursor'),
      fragment: est('fragment'),
    }
  })
  const stemIndex = new Map(runs.map((r, k) => [r.stem, k]))
  const psmRows = existsSync(`${dir}qpx/quantms.psm.parquet`) ? await rows(`${dir}qpx/quantms.psm.parquet`) : []
  const psms: OraclePsm[] = psmRows.map((r, row) => {
    const scores = new Map(((r.additional_scores as { score_name: string; score_value: number }[] | null) ?? []).map((s) => [s.score_name, num(s.score_value)]))
    const get = (k: string) => scores.get(k) ?? NaN
    const qGlobal = get('global_qvalue')
    const q = Number.isNaN(qGlobal) ? get('percolator_qvalue') : qGlobal
    const percolator = get('percolator_score')
    const observed = num(r.observed_mz)
    const calc = num(r.calculated_mz)
    const z = num(r.charge)
    const iso = Number.isNaN(num(r.isotope_error)) ? 0 : num(r.isotope_error)
    return {
      row,
      run: stemIndex.get(String(r.run_file_name)) ?? -1,
      sequence: String(r.sequence),
      peptidoform: String(r.peptidoform),
      charge: z,
      decoy: r.is_decoy === true,
      q,
      score: Number.isNaN(percolator) ? get('ln_hyperscore') : percolator,
      ppm: get('precursor_mz_error_ppm'),
      ppmFromMasses: ((observed - (iso * C13_C12) / z - calc) / calc) * 1e6,
      observedMz: observed,
      calculatedMz: calc,
      nativeId: String(r.spectrum_reference ?? ''),
      scan: num((r.scan as number[] | null)?.[0]),
      mods: ((r.modifications as { name: string; accession: string; positions: { position: number }[] }[] | null) ?? []).map((m) => ({
        name: m.name,
        accession: m.accession,
        positions: m.positions.map((p) => num(p.position)),
      })),
      proteins: ((r.protein_mappings as { accession: string; start: number; end: number }[] | null) ?? []).map((p) => ({
        accession: p.accession,
        start: num(p.start),
        end: num(p.end),
      })),
    }
  })
  const groups: OracleGroup[] = existsSync(`${dir}qpx/quantms.pg.parquet`)
    ? (await rows(`${dir}qpx/quantms.pg.parquet`)).map((g) => {
        const scores = (g.additional_scores as { score_name: string; score_value: number }[] | null) ?? []
        const own = scores.find((s) => s.score_name.toLowerCase().replace(/[^a-z]/g, '') === 'qvalue')
        return { accessions: (g.pg_accessions as string[]).map(String), decoy: g.is_decoy === true, q: own ? num(own.score_value) : num(g.global_qvalue) }
      })
    : []
  const steps = await rows(`${dir}qpx/quantms.provenance.parquet`)
  const stepOf = (n: string) => steps.find((s) => s.step_name === n)
  const params = (s: Row | undefined) => new Map((((s?.parameters as { key: string; value: string }[]) ?? []).map((p) => [p.key, p.value ?? ''])))
  return {
    name,
    psms,
    runs,
    groups,
    search: params(stepOf('peptide_search')),
    fdr: params(stepOf('target_decoy_fdr')),
    toolVersion: String(stepOf('peptide_search')?.tool_version ?? ''),
    fasta: fastaOf(`${dir}database.fasta`),
    inputs: inputs.map((i) => ({ name: i.name, stem: i.stem })),
  }
}

//------------------------------------------------------------------------------
// What the screens should show

export const isContaminant = (accession: string) => accession.startsWith('CON__')

/** A PSM passes the PSM cutoff `limit` (the search's is FIXTURE_PSM_FDR); without q-value only at the search's own. */
export const passesQ = (q: number, limit: number, cutoff = FIXTURE_PSM_FDR) => (Number.isNaN(q) ? limit >= cutoff : q <= limit)

export interface Expected {
  /** target PSMs at the cutoff, contaminants included */
  psms: OraclePsm[]
  peptides: Set<string>
  proteins: Set<string>
  proteinGroups: number
  ms2: number
  spectra: number
  medianAbsPpm: number | null
}

/** The target PSMs at `limit` that the other conditions keep. */
export function targetPsms(f: Fixture, limit = FIXTURE_PSM_FDR, keep: (p: OraclePsm) => boolean = () => true): OraclePsm[] {
  return f.psms.filter((p) => !p.decoy && passesQ(p.q, limit) && keep(p))
}

/** Whether the protein FDR was applied (the provenance's target_decoy_fdr step). */
export const proteinFdrApplied = (f: Fixture) => f.fdr.get('protein_fdr_applied') === 'true'

/** The key figures (KeyFigures.svelte's definitions, its tooltips). */
export function keyFigures(f: Fixture): Expected {
  const psms = targetPsms(f)
  const peptides = new Set(psms.map((p) => p.peptidoform))
  // proteins: target proteins of the groups, with a PSM at the PSM FDR, at the protein FDR if one was applied
  const withPsm = new Set(psms.flatMap((p) => p.proteins.map((m) => m.accession)))
  const proteins = new Set<string>()
  const groupKeys = new Set<string>()
  const applied = proteinFdrApplied(f)
  const seen = new Set<string>()
  for (const g of f.groups) {
    for (const a of g.accessions) {
      // (a protein listed by several runs' rows belongs to the first group that lists it)
      if (seen.has(a)) continue
      seen.add(a)
      const marker = f.search.get('decoy_string') ?? 'DECOY_'
      const decoy = (marker !== '' && a.startsWith(marker)) || (g.decoy && g.accessions.length === 1)
      if (decoy || !withPsm.has(a)) continue
      if (applied && !passesQ(g.q, FIXTURE_PROTEIN_FDR, FIXTURE_PROTEIN_FDR)) continue
      proteins.add(a)
      groupKeys.add(g.accessions.join('+'))
    }
  }
  const ms2 = f.runs.reduce((n, r) => n + r.ms2, 0)
  const spectra = new Set(psms.map((p) => `${p.run}\u0000${p.nativeId || `#${p.row}`}`)).size
  const errors = psms.map((p) => Math.abs(p.ppm)).filter((e) => !Number.isNaN(e)).sort((a, b) => a - b)
  const n = errors.length
  const medianAbsPpm = n === 0 ? null : n % 2 ? errors[n >> 1] : (errors[n / 2 - 1] + errors[n / 2]) / 2
  return { psms, peptides, proteins, proteinGroups: groupKeys.size, ms2, spectra, medianAbsPpm }
}

/** The rows of the Proteins, Peptides and PSMs tabs at their initial filters (contaminants hidden, decoys hidden). */
export function tabCounts(f: Fixture): { proteins: number; peptides: number; psms: number } {
  const k = keyFigures(f)
  const onlyContaminants = (p: OraclePsm) => p.proteins.length > 0 && p.proteins.every((m) => isContaminant(m.accession))
  const psms = k.psms.filter((p) => !onlyContaminants(p))
  return {
    proteins: [...k.proteins].filter((a) => !isContaminant(a)).length,
    peptides: new Set(psms.map((p) => p.peptidoform)).size,
    psms: psms.length,
  }
}

/** The sequence coverage of `accession` by the distinct peptides of its target PSMs at the PSM FDR: covered, length. */
export function coverage(f: Fixture, accession: string): { covered: number; length: number; peptides: Set<string> } {
  const sequence = f.fasta.get(accession) ?? ''
  const covered = new Uint8Array(sequence.length)
  const peptides = new Set<string>()
  for (const p of targetPsms(f)) {
    for (const m of p.proteins) {
      if (m.accession !== accession) continue
      peptides.add(p.sequence)
      // the position the mapping records if the sequence has the peptide there, else where the sequence has it
      let begin = m.start - 1
      if (sequence.substr(begin, p.sequence.length) !== p.sequence) begin = sequence.indexOf(p.sequence)
      if (begin >= 0) covered.fill(1, begin, begin + p.sequence.length)
    }
  }
  return { covered: covered.reduce((n, c) => n + c, 0), length: sequence.length, peptides }
}

/** Target PSMs and peptides (by their best PSM's q) with q at most each cutoff of the q-value curve (0 to the FDR in 50 steps). */
export function qCurve(f: Fixture, steps = 50): { q: number; psms: number; peptides: number }[] {
  const targets = f.psms.filter((p) => !p.decoy && !Number.isNaN(p.q))
  const best = new Map<string, number>()
  for (const p of targets) best.set(p.peptidoform, Math.min(best.get(p.peptidoform) ?? Infinity, p.q))
  return Array.from({ length: steps + 1 }, (_, s) => {
    const q = (FIXTURE_PSM_FDR * s) / steps
    return { q, psms: targets.filter((p) => p.q <= q).length, peptides: [...best.values()].filter((b) => b <= q).length }
  })
}

/** The median, of numbers. */
export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const n = s.length
  return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2
}

/** The stored peaks of a PSM's spectrum: its input's QPX mz view (qpx/runs/<stem>.mz.parquet), by native ID. */
export async function peaksOf(f: Fixture, psm: OraclePsm): Promise<{ mz: number[]; intensity: number[] } | null> {
  const stem = f.runs[psm.run].stem
  for (const path of [`${fixtures}${f.name}/qpx/runs/${stem}.mz.parquet`, `${fixtures}${f.name}/qpx/${stem}.mz.parquet`]) {
    if (!existsSync(path)) continue
    const spectrum = (await rows(path)).find((s) => s.id === psm.nativeId)
    if (!spectrum) return null
    return { mz: (spectrum.mz as number[]).map(num), intensity: (spectrum.intensity as number[]).map(num) }
  }
  return null
}
