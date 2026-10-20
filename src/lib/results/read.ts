// The results reader: ProSE's outputs in a search folder (docs/parity.md) as the web app's result types,
// so that the web app's screens show them unchanged.
//
// The folder is the shim's (src-tauri/src/args.rs, run.rs): inputs.json (the inputs in order, with the
// links `<n>__<name>` ProSE saw and their stems), summary.yaml, qpx/<stem>.psm.parquet,
// oms/<stem>.{psm,search_params,proteins,pg}.parquet, oms/merged.{proteins,pg}.parquet (several
// inputs), spectra/<stem>.psm_spectra.parquet, mods/ (open search), and database.fasta (with the
// contaminants). Without contaminants ProSE searched the user's FASTA: the reader asks for the path of
// summary.yaml's `shared.database_file`, an absolute path, which the `files` callback has to serve too.
// The protein sequences and descriptions come from proteins.fasta (the identified proteins, if the
// folder has it), else the database, else they are left out with a warning (`SearchResult.warnings`).
//
// The `files` contract: resolve with the contents, or reject with `FileNotFound` (or any error or object
// with `notFound: true`, as a Tauri command can send it) when the file does not exist. Only that counts
// as a missing file; any other rejection fails the read, with the file's name in the message. A file
// that is there but cannot be read fails the read too, naming the file.
//
// Rows: the PSM rows are the QPX psm rows of the inputs in order; the OMS psm file has the same rows in
// the same order (joined by position); the sidecar is joined by `psm_id`.

import {
  C13C12_MASSDIFF_U,
  countEnzymatic,
  generatedDecoy,
  isEnz,
  modificationMass,
  openmsString,
  pinEnzymeName,
  proformaString,
  webIonName,
  type DecoyGeneration,
  type Modification,
} from './derive'
import { hasColumn, openParquet, readLeaf, readObjects, readStructList, startZstd, type LeafMode, type ParquetFile } from './parquet'
import { parseModificationAnalysis, parseSummaryYaml, toSummary } from './summary'
import type { PredictedSpectra, ProSEMultiSummary, ProSESummary, ResultTables, StoredSpectra } from './types'

export { ZSTD } from './parquet'

/**
 * The contents of a file of the search folder by its name relative to the folder (or an absolute path).
 * A file that does not exist: reject with FileNotFound (or anything with `notFound: true`).
 */
export type SearchFiles = (name: string) => Promise<Uint8Array>

/** The rejection of `SearchFiles` for a file that does not exist. */
export class FileNotFound extends Error {
  readonly notFound = true
  constructor(name: string) {
    super(`${name} does not exist.`)
    this.name = 'FileNotFound'
  }
}

/** Whether `files` rejected because the file does not exist. */
export function isNotFound(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { notFound?: unknown }).notFound === true
}

export interface SearchResult {
  summary: ProSEMultiSummary
  tables: ResultTables
  spectra: StoredSpectra
  predicted: PredictedSpectra
  /** what could not be read and was left out, for the user (e.g. the protein sequences) */
  warnings: string[]
}

/** Runs `read` on the file `name`; an error names the file. */
async function inFile<T>(name: string, read: () => T | Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (message.startsWith(`${name}:`)) throw e
    throw new Error(`${name}: ${message}`, { cause: e })
  }
}

/** A record of inputs.json (args.rs `InputRecord`). */
interface InputRecord {
  id: string
  index: number
  link: string
  stem: string
  name: string
  path: string
}

const utf8 = new TextDecoder()

/** ProSE's ln(hyperscore), also the name of its feature column */
const HYPERSCORE = 'ln(hyperscore)'
const PEPTDEEP_FEATURES = ['ms2_cosine', 'ms2_spectral_angle', 'ms2_pearson', 'ms2_frac_pred_found', 'rt_abs_error']

const first = (...values: number[]) => values.find((v) => !Number.isNaN(v)) ?? NaN

/** The larger of two numbers, ignoring NaN (C's fmax) */
const fmax = (a: number, b: number) => (Number.isNaN(a) ? b : Number.isNaN(b) ? a : Math.max(a, b))

//------------------------------------------------------------------------------
// One input's files

interface SearchParams {
  enzyme: string
  unspecific: boolean
  keepInitialMet: boolean
  extraFeatures: string[]
  observedMinusTheoretical: boolean
  decoyString: string
  decoyIsPrefix: boolean
}

async function readSearchParams(name: string, bytes: Uint8Array | null): Promise<SearchParams | null> {
  if (!bytes) return null
  return inFile(name, () => searchParamsOf(openParquet(bytes)))
}

async function searchParamsOf(file: ParquetFile): Promise<SearchParams | null> {
  const [row] = await readObjects(file, ['digestion_enzyme', 'enzyme_term_specificity', 'sp_metavalues'])
  if (!row) return null
  const meta = new Map(((row.sp_metavalues as { name: string; value: string }[] | null) ?? []).map((m) => [m.name, m.value]))
  return {
    enzyme: String(row.digestion_enzyme ?? ''),
    unspecific: String(row.enzyme_term_specificity ?? '').toUpperCase() === 'NONE',
    keepInitialMet: meta.get('peptide:clip_nterm_methionine') === 'true',
    extraFeatures: (meta.get('extra_features') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    observedMinusTheoretical: meta.get('isotope_error_convention') === 'observed_minus_theoretical',
    decoyString: meta.get('PeptideIndexer:decoy_string') ?? 'DECOY_',
    decoyIsPrefix: (meta.get('PeptideIndexer:decoy_string_position') ?? 'prefix') === 'prefix',
  }
}

/** The PSM rows of one input: its QPX psm, OMS psm and sidecar columns. */
interface InputRows {
  count: number
  psmId: unknown[]
  sequence: unknown[]
  charge: Float64Array
  pep: Float64Array
  decoy: unknown[]
  /** the QPX scores: names as codes into `names` */
  scores: { offsets: Uint32Array; name: Int32Array; names: string[]; value: Float64Array }
  modifications: (QpxModification[] | null)[] | null
  nativeId: unknown[]
  rt: Float64Array
  observedMz: Float64Array
  calculatedMz: Float64Array
  score: Float64Array
  scoreType: unknown[]
  /** the OMS meta values: names as codes into `names`, values as numbers */
  meta: { offsets: Uint32Array; name: Int32Array; names: string[]; value: Float64Array }
  evidence: { offsets: Uint32Array; accession: unknown[]; aa_before: unknown[]; aa_after: unknown[]; start: Float64Array; end: Float64Array }
  sidecar: Sidecar | null
}

interface QpxModification {
  name: string
  accession: string | null
  positions: { position: number }[]
}

interface ListLeaf<T> {
  offsets: Uint32Array
  nullList: Uint8Array
  values: T
}

interface Sidecar {
  /** the sidecar row of each QPX row; -1: none */
  rowOf: Int32Array
  peakMz: ListLeaf<Float32Array>
  peakIntensity: ListLeaf<Float32Array>
  /** the ion names as codes into `ionNames` */
  ion: ListLeaf<Int32Array>
  ionNames: string[]
  predictedMz: ListLeaf<Float32Array>
  predictedIntensity: ListLeaf<Float32Array>
}

function listLeaf<T>(file: ParquetFile, column: string, mode: LeafMode = 'values'): ListLeaf<T> & { dictionary?: string[] } {
  const leaf = readLeaf(file, [column, 'list', 'element'], mode)
  return { offsets: leaf.offsets!, nullList: leaf.nullList!, values: leaf.values as T, dictionary: leaf.dictionary }
}

/** The names of an input's PSM files. */
interface InputFiles {
  qpx: string
  oms: string
  sidecar: string
}

async function readInput(names: InputFiles, qpxBytes: Uint8Array, omsBytes: Uint8Array, sidecarBytes: Uint8Array | null): Promise<InputRows> {
  const flat = <T>(file: ParquetFile, column: string) => readLeaf(file, [column]).values as T
  const q = await inFile(names.qpx, async () => {
    const qpx = openParquet(qpxBytes)
    const scores = readStructList(qpx, 'additional_scores', ['score_name', 'score_value'], { score_name: 'codes' })
    // the modifications (a list of lists): only if some row has any
    const modLeaf = readLeaf(qpx, ['modifications', 'list', 'element', 'name'])
    const modified = modLeaf.offsets![qpx.rows] > 0
    return {
      rows: qpx.rows,
      psmId: flat<unknown[]>(qpx, 'psm_id'),
      sequence: flat<unknown[]>(qpx, 'sequence'),
      charge: flat<Float64Array>(qpx, 'charge'),
      pep: flat<Float64Array>(qpx, 'posterior_error_probability'),
      decoy: flat<unknown[]>(qpx, 'is_decoy'),
      scores: {
        offsets: scores.offsets,
        name: scores.score_name as Int32Array,
        names: scores.dictionaries.score_name ?? [],
        value: scores.score_value as Float64Array,
      },
      modifications: modified
        ? (await readObjects(qpx, ['modifications'])).map((r) => (r.modifications as QpxModification[] | null) ?? null)
        : null,
    }
  })
  const o = await inFile(names.oms, () => {
    const oms = openParquet(omsBytes)
    // the names as codes, the values as numbers: the reader needs none of them as text
    const meta = readStructList(oms, 'psm_metavalues', ['name', 'value'], { name: 'codes', value: 'numbers' })
    const evidence = readStructList(oms, 'protein_accessions', ['accession', 'aa_before', 'aa_after', 'start', 'end'])
    return {
      rows: oms.rows,
      nativeId: flat<unknown[]>(oms, 'spectrum_reference'),
      rt: flat<Float64Array>(oms, 'rt'),
      observedMz: flat<Float64Array>(oms, 'observed_mz'),
      calculatedMz: flat<Float64Array>(oms, 'calculated_mz'),
      score: flat<Float64Array>(oms, 'score'),
      scoreType: flat<unknown[]>(oms, 'score_type'),
      meta: { offsets: meta.offsets, name: meta.name as Int32Array, names: meta.dictionaries.name ?? [], value: meta.value as Float64Array },
      evidence: {
        offsets: evidence.offsets,
        accession: evidence.accession as unknown[],
        aa_before: evidence.aa_before as unknown[],
        aa_after: evidence.aa_after as unknown[],
        start: evidence.start as Float64Array,
        end: evidence.end as Float64Array,
      },
    }
  })
  if (q.rows !== o.rows) throw new Error(`${names.oms}: ${o.rows} PSMs, but ${q.rows} in ${names.qpx}`)
  const sidecar = sidecarBytes ? await inFile(names.sidecar, () => readSidecar(openParquet(sidecarBytes), q.psmId)) : null
  const { rows, ...qpxColumns } = q
  const { rows: _rows, ...omsColumns } = o
  return { count: rows, ...qpxColumns, ...omsColumns, sidecar }
}

/** The sidecar's columns and, for each QPX row (by its psm_id), its sidecar row. */
function readSidecar(file: ParquetFile, psmId: unknown[]): Sidecar {
  const ids = readLeaf(file, ['psm_id']).values as unknown[]
  const rowOf = new Int32Array(psmId.length).fill(-1)
  const positional = ids.length === psmId.length && psmId.every((id, i) => id === ids[i])
  if (positional) {
    for (let i = 0; i < rowOf.length; i++) rowOf[i] = i
  } else {
    const row = new Map<unknown, number>()
    ids.forEach((id, i) => row.set(id, i))
    psmId.forEach((id, i) => (rowOf[i] = row.get(id) ?? -1))
  }
  const has = (c: string) => hasColumn(file, c)
  const ion = has('predicted_ion_type_array') ? listLeaf<Int32Array>(file, 'predicted_ion_type_array', 'codes') : null
  const empty = <T>(values: T): ListLeaf<T> => ({ offsets: new Uint32Array(ids.length + 1), nullList: new Uint8Array(ids.length).fill(1), values })
  return {
    rowOf,
    peakMz: has('peak_mz_array') ? listLeaf(file, 'peak_mz_array') : empty(new Float32Array(0)),
    peakIntensity: has('peak_intensity_array') ? listLeaf(file, 'peak_intensity_array') : empty(new Float32Array(0)),
    ion: ion ?? empty(new Int32Array(0)),
    // as the web app names them
    ionNames: (ion?.dictionary ?? []).map(webIonName),
    predictedMz: has('predicted_mz_array') ? listLeaf(file, 'predicted_mz_array') : empty(new Float32Array(0)),
    predictedIntensity: has('predicted_intensity_array') ? listLeaf(file, 'predicted_intensity_array') : empty(new Float32Array(0)),
  }
}

//------------------------------------------------------------------------------
// FASTA

interface FastaEntry {
  description: string
  sequence: string
}

/** The entries of a FASTA file by identifier (the header up to the first white space, as OpenMS' FASTAFile). */
function readFasta(text: string): Map<string, FastaEntry> {
  const entries = new Map<string, FastaEntry>()
  let id: string | null = null
  let description = ''
  let parts: string[] = []
  const flush = () => {
    if (id !== null && !entries.has(id)) entries.set(id, { description, sequence: parts.join('') })
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('>')) {
      flush()
      const header = line.slice(1).trim()
      const space = header.search(/\s/)
      id = space < 0 ? header : header.slice(0, space)
      description = space < 0 ? '' : header.slice(space).trim()
      parts = []
    } else if (id !== null && line !== '') {
      parts.push(line.replace(/\s+/g, ''))
    }
  }
  flush()
  return entries
}

/** The sequence as ProSE searches it: without the stop codons ('*') at its end. */
const searched = (sequence: string) => sequence.replace(/\*+$/, '')

//------------------------------------------------------------------------------
// The reader

/** Reads the search folder that `files` serves. */
export async function readSearch(files: SearchFiles): Promise<SearchResult> {
  const zstd = startZstd()
  const warnings: string[] = []
  /** a file that may be missing: null if it does not exist */
  const optional = (name: string) =>
    files(name).catch((e: unknown) => {
      if (isNotFound(e)) return null
      throw new Error(`${name}: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
    })
  const required = async (name: string) => {
    const bytes = await optional(name)
    if (!bytes) throw new FileNotFound(name)
    return bytes
  }

  const inputs = await inFile('inputs.json', async () =>
    (JSON.parse(utf8.decode(await required('inputs.json'))) as InputRecord[]).sort((a, b) => a.index - b.index),
  )
  const yaml = await inFile('summary.yaml', async () => parseSummaryYaml(utf8.decode(await required('summary.yaml'))))
  const several = inputs.length > 1
  await zstd

  const proteinsName = several ? 'oms/merged.proteins.parquet' : `oms/${inputs[0]?.stem}.proteins.parquet`
  const groupsName = several ? 'oms/merged.pg.parquet' : `oms/${inputs[0]?.stem}.pg.parquet`
  const [perInput, params, proteinBytes, groupBytes] = await Promise.all([
    Promise.all(
      inputs.map(async ({ stem }) => {
        const names = { qpx: `qpx/${stem}.psm.parquet`, oms: `oms/${stem}.psm.parquet`, sidecar: `spectra/${stem}.psm_spectra.parquet` }
        const [qpx, oms, sidecar] = await Promise.all([optional(names.qpx), optional(names.oms), optional(names.sidecar)])
        // an input whose search failed may have no outputs; but not one of the two PSM files only
        if (!qpx !== !oms) throw new Error(`${qpx ? names.oms : names.qpx} does not exist, but ${qpx ? names.qpx : names.oms} does.`)
        return qpx && oms ? readInput(names, qpx, oms, sidecar) : null
      }),
    ),
    Promise.all(
      inputs.map(({ stem }) => {
        const name = `oms/${stem}.search_params.parquet`
        return optional(name).then((bytes) => readSearchParams(name, bytes))
      }),
    ),
    optional(proteinsName),
    optional(groupsName),
  ])
  const run = params.find((p) => p !== null) ?? null
  const decoyString = run?.decoyString ?? 'DECOY_'
  const decoyIsPrefix = run?.decoyIsPrefix ?? true
  const hasDecoyMarker = (accession: string) =>
    decoyString !== '' && (decoyIsPrefix ? accession.startsWith(decoyString) : accession.endsWith(decoyString))

  //------------------------------------------------------------------------------
  // Proteins: the hits of the pooled run (several inputs: the merged inference), with the FASTA

  const proteins = proteinBytes
    ? await inFile(proteinsName, () => {
        const file = openParquet(proteinBytes)
        return {
          rows: file.rows,
          accession: (readLeaf(file, ['accession']).values as unknown[]).map(String),
          score: readLeaf(file, ['score']).values as Float64Array,
          isDecoy: readLeaf(file, ['is_decoy']).values as unknown[],
          description: readLeaf(file, ['description']).values as unknown[],
        }
      })
    : null
  const proteinCount = proteins?.rows ?? 0
  const accession = proteins?.accession ?? []
  const proteinRow = new Map<string, number>()
  accession.forEach((a, p) => {
    if (!proteinRow.has(a)) proteinRow.set(a, p)
  })
  const description = new Array<string>(proteinCount).fill('')
  const proteinSequence = new Array<string>(proteinCount).fill('')
  const proteinScore = new Float64Array(proteinCount).fill(NaN)
  const proteinQ = new Float64Array(proteinCount).fill(NaN)
  const proteinDecoy = new Uint8Array(proteinCount)
  const group = new Int32Array(proteinCount).fill(-1)
  if (proteins && proteinCount > 0) {
    const qValues = yaml.protein_fdr_applied === true
    // the sequences and descriptions: proteins.fasta (the identified proteins), else the database (the
    // folder's database.fasta with contaminants, else the user's FASTA), else none, with a warning
    let fasta = new Map<string, FastaEntry>()
    let identified = false
    const tried: string[] = []
    const sources: [string, boolean][] = [
      ['proteins.fasta', true],
      ['database.fasta', false],
      [String(yaml.shared?.database_file ?? ''), false],
    ]
    let found = false
    for (const [name, own] of sources) {
      if (name === '') continue
      try {
        const bytes = await files(name)
        fasta = readFasta(utf8.decode(bytes))
        identified = own
        found = true
        break
      } catch (e) {
        tried.push(isNotFound(e) ? `${name} (not found)` : `${name} (${e instanceof Error ? e.message : String(e)})`)
      }
    }
    if (!found) {
      warnings.push(`The protein sequences are not available, so there is no sequence coverage: none of ${tried.join(', ')} could be read.`)
    }
    const decoys: DecoyGeneration = {
      enzyme: run?.enzyme ?? String(yaml.shared?.enzyme ?? ''),
      keepInitialMet: run?.keepInitialMet ?? true,
      unspecific: run?.unspecific ?? false,
    }
    const generated = yaml.shared?.decoy_mode === 'generated'
    for (let p = 0; p < proteinCount; p++) {
      const a = accession[p]
      const isDecoy = proteins.isDecoy[p]
      const decoy = isDecoy === true || (isDecoy == null && hasDecoyMarker(a))
      proteinDecoy[p] = decoy ? 1 : 0
      if (qValues) proteinQ[p] = proteins.score[p]
      const own = proteins.description[p]
      description[p] = typeof own === 'string' ? own : ''
      // proteins.fasta has the proteins as searched, decoys included
      const listed = identified ? fasta.get(a) : undefined
      // a decoy ProSE generated is the decoy marker + the accession of its target (whose description it
      // gets, as in the web app); generated decoys also replace decoys of the FASTA
      const ofTarget = !listed && decoy && generated && decoyIsPrefix && hasDecoyMarker(a)
      const entry = listed ?? (ofTarget ? fasta.get(a.slice(decoyString.length)) : fasta.get(a))
      if (entry) {
        proteinSequence[p] = ofTarget ? generatedDecoy(searched(entry.sequence), decoys) : searched(entry.sequence)
        if (description[p] === '') description[p] = entry.description
      }
    }
  }
  // the groups of indistinguishable proteins; where the tool wrote none (one input without protein FDR:
  // no inference), each protein is a group of its own, as in the web app
  let groupCount = 0
  if (groupBytes && proteinCount > 0) {
    groupCount = await inFile(groupsName, () => {
      const groups = openParquet(groupBytes)
      const types = readLeaf(groups, ['group_type']).values as unknown[]
      const members = readLeaf(groups, ['accessions', 'list', 'element'])
      let g = 0
      for (let r = 0; r < groups.rows; r++) {
        if (types[r] !== 'indistinguishable') continue
        for (let k = members.offsets![r]; k < members.offsets![r + 1]; k++) {
          const p = proteinRow.get(String((members.values as unknown[])[k]))
          if (p !== undefined && group[p] < 0) group[p] = g
        }
        g++
      }
      return g
    })
  }
  if (groupCount === 0) for (let p = 0; p < proteinCount; p++) group[p] = p

  //------------------------------------------------------------------------------
  // PSMs and their peptides

  const count = perInput.reduce((n, f) => n + (f?.count ?? 0), 0)
  let minCharge = Number(yaml.shared?.min_charge ?? Infinity)
  let maxCharge = Number(yaml.shared?.max_charge ?? -Infinity)
  for (const f of perInput) {
    if (!f) continue
    for (const c of f.charge) {
      minCharge = Math.min(minCharge, c)
      maxCharge = Math.max(maxCharge, c)
    }
  }

  // the features: ln(hyperscore), the standard .pin features (PercolatorInfile::getStandardFeatureSet
  // without the bookkeeping columns), the runs' extra_features, PeptDeep's; those some PSM has
  const featureNames: string[] = [HYPERSCORE]
  const pin = new Set<string>()
  const addFeature = (name: string, isPin = false) => {
    if (name === '' || name === 'score' || name === HYPERSCORE || featureNames.includes(name)) return
    featureNames.push(name)
    if (isPin) pin.add(name)
  }
  const chargeFeatures: string[] = []
  for (let c = minCharge; Number.isFinite(c) && c <= maxCharge; c++) chargeFeatures.push(`charge${c}`)
  for (const name of ['CalcMass', 'mass', 'peplen', ...chargeFeatures, 'enzN', 'enzC', 'enzInt', 'dm', 'absdm']) addFeature(name, true)
  for (const p of params) for (const name of p?.extraFeatures ?? []) addFeature(name)
  for (const name of PEPTDEEP_FEATURES) addFeature(name)
  const nFeatures = featureNames.length
  const featureIndex = new Map(featureNames.map((n, j) => [n, j]))

  // the meta values the columns need, by name: a slot of `values` below
  const META = [
    'precursor_mz_error_ppm',
    'isotope_error',
    'IsotopeError',
    'DeltaMass',
    'CalcMass',
    'percolator_score',
    'percolator_q_value',
    'percolator_pep',
    'MS:1001492',
    'MS:1001491',
    'MS:1001493',
    'q-value',
    'q-value_score',
    'Posterior Error Probability_score',
    HYPERSCORE,
    `${HYPERSCORE}_score`,
  ] as const
  type MetaName = (typeof META)[number]
  const metaSlot = new Map<string, number>(META.map((n, k) => [n, k]))
  const values = new Float64Array(META.length)
  const scoreValues = new Float64Array(META.length)
  const slot = (n: MetaName) => metaSlot.get(n)!
  const featureOfMeta = new Map<string, number>()
  for (const [n, j] of featureIndex) if (!pin.has(n) && j > 0) featureOfMeta.set(n, j)
  /** what a meta value name is for: [its slot or −1, its feature column or −1]; null: nothing */
  const uses = new Map<string, [number, number] | null>()
  const useOf = (name: string) => {
    let use = uses.get(name)
    if (use === undefined) {
      const [s, j] = [metaSlot.get(name) ?? -1, featureOfMeta.get(name) ?? -1]
      use = s < 0 && j < 0 ? null : [s, j]
      uses.set(name, use)
    }
    return use
  }
  // the columns of the .pin features
  const pinColumn = (name: string) => featureIndex.get(name)!
  const [calcMassJ, massJ, peplenJ, enzNJ, enzCJ, enzIntJ, dmJ, absdmJ] = ['CalcMass', 'mass', 'peplen', 'enzN', 'enzC', 'enzInt', 'dm', 'absdm'].map(pinColumn)
  const chargeColumns = chargeFeatures.map(pinColumn)
  const [hyperscoreS, hyperscoreScoreS, percolatorScoreS, percolatorScoreCvS, percolatorQS, qCvS, qS, qScoreS, percolatorPepS, pepCvS, pepScoreS] = (
    [HYPERSCORE, `${HYPERSCORE}_score`, 'percolator_score', 'MS:1001492', 'percolator_q_value', 'MS:1001491', 'q-value', 'q-value_score', 'percolator_pep', 'MS:1001493', 'Posterior Error Probability_score'] as MetaName[]
  ).map(slot)
  const [precursorErrorS, isotopeErrorS, legacyIsotopeErrorS, deltaMassS, calcMassS] = (
    ['precursor_mz_error_ppm', 'isotope_error', 'IsotopeError', 'DeltaMass', 'CalcMass'] as MetaName[]
  ).map(slot)

  const psmFile = new Uint16Array(count)
  const nativeId = new Array<string>(count)
  const rt = new Float64Array(count)
  const mz = new Float64Array(count)
  const charge = new Int8Array(count)
  const peptide = new Uint32Array(count)
  const score = new Float64Array(count)
  const qValue = new Float64Array(count)
  const pep = new Float64Array(count)
  const precursorErrorPpm = new Float64Array(count)
  const isotopeError = new Int8Array(count)
  const deltaMass = new Float64Array(count)
  const decoy = new Uint8Array(count)
  const features = new Float64Array(count * nFeatures).fill(NaN)
  const featurePresent = new Uint8Array(nFeatures)
  featurePresent[0] = 1

  const peptideRow = new Map<string, number>()
  const pt = {
    openms: [] as string[],
    proforma: [] as string[],
    sequence: [] as string[],
    decoy: [] as number[],
    modOffsets: [0],
    modPosition: [] as number[],
    modName: [] as string[],
    modUnimod: [] as number[],
    modMass: [] as number[],
    proteinOffsets: [0],
    protein: [] as number[],
    start: [] as number[],
    end: [] as number[],
  }
  const peptideBest: number[] = []

  const clampInt8 = (v: number) => (Number.isNaN(v) ? 0 : Math.max(-128, Math.min(127, Math.round(v))))

  let i = 0
  perInput.forEach((f, fileIndex) => {
    if (!f) return
    const p = params[fileIndex] ?? run
    const enzyme = pinEnzymeName(p?.enzyme ?? String(yaml.shared?.enzyme ?? ''))
    const sign = p?.observedMinusTheoretical === false ? -1 : 1
    const metaUses = f.meta.names.map(useOf)
    const scoreUses = f.scores.names.map(useOf)
    for (let r = 0; r < f.count; r++, i++) {
      psmFile[i] = fileIndex
      nativeId[i] = String(f.nativeId[r] ?? '')
      rt[i] = f.rt[r]
      mz[i] = f.observedMz[r]
      const z = f.charge[r]
      charge[i] = clampInt8(z)
      decoy[i] = f.decoy[r] === true ? 1 : 0

      // the meta values (strings) and the QPX scores (doubles, full precision)
      values.fill(NaN)
      scoreValues.fill(NaN)
      const row = i * nFeatures
      for (let k = f.meta.offsets[r]; k < f.meta.offsets[r + 1]; k++) {
        const c = f.meta.name[k]
        const use = c < 0 ? null : metaUses[c]
        if (use === null) continue
        const v = f.meta.value[k]
        if (use[0] >= 0) values[use[0]] = v
        if (use[1] >= 0 && !Number.isNaN(v)) {
          features[row + use[1]] = v
          featurePresent[use[1]] = 1
        }
      }
      for (let k = f.scores.offsets[r]; k < f.scores.offsets[r + 1]; k++) {
        const c = f.scores.name[k]
        const use = c < 0 ? null : scoreUses[c]
        if (use !== null && use[0] >= 0) scoreValues[use[0]] = f.scores.value[k]
      }
      // a score of the QPX file (a double) before the same of the meta values (a string of it)
      const both = (s: number) => (Number.isNaN(scoreValues[s]) ? values[s] : scoreValues[s])
      const type = f.scoreType[r]
      const omsScore = f.score[r]
      const hyperscore = type === HYPERSCORE ? omsScore : first(both(hyperscoreS), both(hyperscoreScoreS))
      const percolator = type === 'svm' ? omsScore : first(both(percolatorScoreCvS), both(percolatorScoreS))
      const s = Number.isNaN(percolator) ? hyperscore : percolator
      score[i] = s
      qValue[i] = type === 'q-value' ? omsScore : first(both(percolatorQS), both(qCvS), both(qS), both(qScoreS))
      pep[i] = type === 'Posterior Error Probability' ? omsScore : first(f.pep[r], both(percolatorPepS), both(pepCvS), both(pepScoreS))
      precursorErrorPpm[i] = values[precursorErrorS]
      isotopeError[i] = clampInt8(sign * values[isotopeErrorS])
      deltaMass[i] = values[deltaMassS]
      features[row] = hyperscore

      // the .pin features (PercolatorInfile::stampPinFeaturesOnHits); none for a hit without a protein
      const sequence = String(f.sequence[r] ?? '')
      const e0 = f.evidence.offsets[r]
      if (f.evidence.offsets[r + 1] > e0) {
        const calc = first(values[calcMassS], f.calculatedMz[r])
        const observed = f.observedMz[r]
        const iso = Math.fround(first(values[legacyIsotopeErrorS], values[isotopeErrorS]))
        const dm = (Number.isNaN(iso) ? observed : observed - (iso * C13C12_MASSDIFF_U) / z) - calc
        const before = String(f.evidence.aa_before[e0] ?? '')
        const after = String(f.evidence.aa_after[e0] ?? '')
        const set = (j: number, v: number) => {
          features[row + j] = v
          if (!Number.isNaN(v)) featurePresent[j] = 1
        }
        set(calcMassJ, calc)
        set(massJ, observed)
        set(peplenJ, sequence.length)
        for (let c = 0; c < chargeColumns.length; c++) set(chargeColumns[c], minCharge + c === z ? 1 : 0)
        set(enzNJ, isEnz(before.charAt(0), sequence.charAt(0), enzyme) ? 1 : 0)
        set(enzCJ, isEnz(sequence.charAt(sequence.length - 1), after.charAt(0), enzyme) ? 1 : 0)
        set(enzIntJ, countEnzymatic(sequence, enzyme))
        set(dmJ, dm)
        set(absdmJ, Math.abs(dm))
      }

      // its peptide, unique by the OpenMS string
      const mods = modificationsOf(f.modifications?.[r] ?? null, sequence.length)
      const openms = openmsString(sequence, mods)
      let k = peptideRow.get(openms)
      if (k !== undefined) {
        peptide[i] = k
        peptideBest[k] = fmax(peptideBest[k], s)
        continue
      }
      k = pt.openms.length
      peptideRow.set(openms, k)
      peptide[i] = k
      peptideBest.push(s)
      pt.openms.push(openms)
      pt.proforma.push(proformaString(sequence, mods))
      pt.sequence.push(sequence)
      pt.decoy.push(decoy[i])
      for (const m of mods) {
        pt.modPosition.push(m.position)
        pt.modName.push(m.name)
        pt.modUnimod.push(m.unimod)
        pt.modMass.push(m.mass)
      }
      pt.modOffsets.push(pt.modPosition.length)
      // its proteins: the evidences of its first PSM whose protein is a row of the proteins
      for (let e = e0; e < f.evidence.offsets[r + 1]; e++) {
        const p = proteinRow.get(String(f.evidence.accession[e]))
        if (p === undefined) continue // a protein the protein FDR removed
        const protein = proteinSequence[p]
        let from = f.evidence.start[e]
        let to = f.evidence.end[e]
        let known = from >= 0 && to >= from
        const inSequence =
          known && to < protein.length && to - from + 1 === sequence.length && protein.startsWith(sequence, from)
        if (!inSequence) {
          const at = protein.indexOf(sequence)
          if (at >= 0 && sequence.length > 0) {
            from = at
            to = at + sequence.length - 1
            known = true
          }
        }
        pt.protein.push(p)
        pt.start.push(known ? from : 0)
        pt.end.push(known ? to + 1 : 0)
      }
      pt.proteinOffsets.push(pt.protein.length)
    }
  })

  // the score of a protein: the best score of its PSMs
  for (let k = 0; k < pt.openms.length; k++) {
    for (let r = pt.proteinOffsets[k]; r < pt.proteinOffsets[k + 1]; r++) {
      proteinScore[pt.protein[r]] = fmax(proteinScore[pt.protein[r]], peptideBest[k])
    }
  }

  // only the features some PSM has
  const kept = featureNames.map((_, j) => j).filter((j) => featurePresent[j])
  let keptFeatures = features
  if (kept.length !== nFeatures) {
    keptFeatures = new Float64Array(count * kept.length)
    for (let r = 0; r < count; r++) for (let c = 0; c < kept.length; c++) keptFeatures[r * kept.length + c] = features[r * nFeatures + kept[c]]
  }

  const paths = inputs.map((r) => r.path)
  const tables: ResultTables = {
    files: paths,
    psms: {
      count,
      file: psmFile,
      nativeId,
      rt,
      mz,
      charge,
      peptide,
      score,
      qValue,
      pep,
      precursorErrorPpm,
      isotopeError,
      deltaMass,
      decoy,
      featureNames: kept.map((j) => featureNames[j]),
      features: keptFeatures,
    },
    peptides: {
      count: pt.openms.length,
      openms: pt.openms,
      proforma: pt.proforma,
      sequence: pt.sequence,
      decoy: Uint8Array.from(pt.decoy),
      modOffsets: Uint32Array.from(pt.modOffsets),
      modPosition: Int16Array.from(pt.modPosition),
      modName: pt.modName,
      modUnimod: Int32Array.from(pt.modUnimod),
      modMass: Float64Array.from(pt.modMass),
      proteinOffsets: Uint32Array.from(pt.proteinOffsets),
      protein: Uint32Array.from(pt.protein),
      start: Uint32Array.from(pt.start),
      end: Uint32Array.from(pt.end),
    },
    proteins: {
      count: proteinCount,
      accession,
      description,
      sequence: proteinSequence,
      score: proteinScore,
      qValue: proteinQ,
      decoy: proteinDecoy,
      group,
    },
  }

  //------------------------------------------------------------------------------
  // Spectra and predictions: the sidecar rows of the PSMs

  const { spectra, predicted } = spectraOf(perInput, count)

  //------------------------------------------------------------------------------
  // Summary

  let modificationAnalysis: ProSESummary['modificationAnalysis'] = null
  if (yaml.shared?.open_search === true && inputs.length > 0) {
    const prefix = several ? '_aggregate_across_files' : inputs[0].stem
    const [deltas, ptms] = await Promise.all([
      optional(`mods/${prefix}_ModificationAnalysis_DeltaMassStats.tsv`),
      optional(`mods/${prefix}_ModificationAnalysis_PTMStats.tsv`),
    ])
    if (deltas && ptms) {
      const name = `mods/${prefix}_ModificationAnalysis_{DeltaMassStats,PTMStats}.tsv`
      modificationAnalysis = await inFile(name, () => parseModificationAnalysis(utf8.decode(deltas), utf8.decode(ptms)))
    }
  }
  const summary = toSummary(yaml, paths, decoyString, modificationAnalysis)
  return { summary, tables, spectra, predicted, warnings }
}

/** The modifications of a QPX row, by position (−1 N-terminal, the length C-terminal, else 0-based). */
function modificationsOf(mods: QpxModification[] | null, length: number): Modification[] {
  if (!mods || mods.length === 0) return []
  const out: Modification[] = []
  for (const m of mods) {
    const accession = /^UNIMOD:(\d+)$/i.exec(m.accession ?? '')
    const unimod = accession ? Number(accession[1]) : -1
    for (const { position } of m.positions ?? []) {
      out.push({
        position: position === 0 ? -1 : position === length + 1 ? length : position - 1,
        name: m.name,
        unimod,
        mass: modificationMass(m.name, unimod),
      })
    }
  }
  return out.sort((a, b) => a.position - b.position)
}

/** StoredSpectra (one spectrum per PSM row with peaks) and PredictedSpectra of the sidecars. */
function spectraOf(perInput: (InputRows | null)[], count: number): { spectra: StoredSpectra; predicted: PredictedSpectra } {
  let peakCount = 0
  let spectrumCount = 0
  let ionCount = 0
  for (const f of perInput) {
    const sc = f?.sidecar
    if (!sc) continue
    for (let r = 0; r < f.count; r++) {
      const s = sc.rowOf[r]
      if (s < 0) continue
      if (!sc.peakMz.nullList[s]) {
        spectrumCount++
        peakCount += sc.peakMz.offsets[s + 1] - sc.peakMz.offsets[s]
      }
      if (!sc.ion.nullList[s]) ionCount += sc.ion.offsets[s + 1] - sc.ion.offsets[s]
    }
  }
  const psmSpectrum = new Int32Array(count).fill(-1)
  const offsets = new Uint32Array(spectrumCount + 1)
  const mz = new Float32Array(peakCount)
  const intensity = new Float32Array(peakCount)
  const precursorMz = new Float64Array(spectrumCount)
  const psmOffsets = new Uint32Array(count + 1)
  const ion = new Array<string>(ionCount)
  const predictedMz = new Float32Array(ionCount)
  const predictedIntensity = new Float32Array(ionCount)

  let i = 0
  let spectrum = 0
  let peak = 0
  let ions = 0
  for (const f of perInput) {
    if (!f) continue
    const sc = f.sidecar
    for (let r = 0; r < f.count; r++, i++) {
      psmOffsets[i] = ions
      const s = sc ? sc.rowOf[r] : -1
      if (!sc || s < 0) continue
      // (element by element: a PSM has tens of peaks, too few for subarray() and set())
      if (!sc.peakMz.nullList[s]) {
        const from = sc.peakMz.offsets[s]
        const n = sc.peakMz.offsets[s + 1] - from
        const intensityFrom = sc.peakIntensity.offsets[s]
        for (let k = 0; k < n; k++) {
          mz[peak + k] = sc.peakMz.values[from + k]
          intensity[peak + k] = sc.peakIntensity.values[intensityFrom + k]
        }
        peak += n
        precursorMz[spectrum] = f.observedMz[r]
        psmSpectrum[i] = spectrum++
        offsets[spectrum] = peak
      }
      if (!sc.ion.nullList[s]) {
        const from = sc.ion.offsets[s]
        const n = sc.ion.offsets[s + 1] - from
        const mzFrom = sc.predictedMz.offsets[s]
        const intensityFrom = sc.predictedIntensity.offsets[s]
        for (let k = 0; k < n; k++) {
          const c = sc.ion.values[from + k]
          ion[ions + k] = c < 0 ? '' : sc.ionNames[c]
          predictedMz[ions + k] = sc.predictedMz.values[mzFrom + k]
          predictedIntensity[ions + k] = sc.predictedIntensity.values[intensityFrom + k]
        }
        ions += n
      }
    }
  }
  psmOffsets[count] = ions
  return {
    spectra: {
      psmSpectrum,
      offsets,
      mz,
      intensity,
      precursorMz,
      // not read: the web app took it as a fallback NCE for its own predictions; these are ProSE's
      collisionEnergy: new Float32Array(spectrumCount).fill(NaN),
    },
    predicted: { psmOffsets, ion, mz: predictedMz, intensity: predictedIntensity },
  }
}
