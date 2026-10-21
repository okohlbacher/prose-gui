// The results reader: ProSE's QPX outputs in a search folder (docs/parity.md) as the web app's result types,
// so that the web app's screens show them unchanged.
//
// The folder is the shim's (src-tauri/src/args.rs, run.rs): inputs.json (the inputs in order, with the
// links `<n>__<name>` ProSE saw and their stems), qpx/<stem>.psm.parquet (the QPX psm view of each input with
// the optional columns and the footer of ProSE's -qpx_extended), qpx/quantms.pg.parquet (the protein groups:
// of several inputs the pooled inference), mods/ (open search: the tables the footer names), and
// database.fasta (with the contaminants). Without contaminants ProSE searched the user's FASTA: the reader
// asks for the path the footer records (`prose_database_file`), an absolute path, which the `files` callback
// has to serve too. The protein sequences and descriptions come from proteins.fasta (the identified
// proteins, if the folder has it), else the database, else they are left out with a warning
// (`SearchResult.warnings`).
//
// The `files` contract: resolve with the contents, or reject with `FileNotFound` (or any error or object
// with `notFound: true`, as a Tauri command can send it) when the file does not exist. Only that counts
// as a missing file; any other rejection fails the read, with the file's name in the message. A file
// that is there but cannot be read fails the read too, naming the file.
//
// Rows: the PSM rows are the QPX psm rows of the inputs in order; their peaks and PeptDeep's prediction
// are columns of the same rows.

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
import { footerOf, hasColumn, openParquet, readLeaf, readObjects, readStructList, startZstd, type LeafMode, type ParquetFile } from './parquet'
import { filesOf, footerFlag, footerNumber, parseModificationAnalysis, toSummary, type Footer } from './summary'
import type { PredictedSpectra, ProSESummary, ProSEMultiSummary, ResultTables, StoredSpectra } from './types'

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

/**
 * A search folder of the app's earlier layout (summary.yaml and OpenMS' own Parquet files next to the QPX
 * files), which this version does not read.
 */
export class OldLayoutError extends Error {
  readonly oldLayout = true
  constructor() {
    super(
      'This search was saved by an earlier version of ProSE Desktop, whose results this version cannot read. ' +
        'Open it with that version, or run the search again.',
    )
    this.name = 'OldLayoutError'
  }
}

/** The peak filter of the stored spectra: the `top` most intense peaks per `window` Th, and the annotated ones. */
export interface PeakFilter {
  top: number
  window: number
}

export interface SearchResult {
  summary: ProSEMultiSummary
  tables: ResultTables
  spectra: StoredSpectra
  predicted: PredictedSpectra
  /** what could not be read and was left out, for the user (e.g. the protein sequences) */
  warnings: string[]
  /**
   * The protein sequences came from the folder's proteins.fasta, or there are no proteins: History need not
   * write proteins.fasta for this search (it does when this is false: history.ts, `openSearch`).
   */
  proteinsSaved: boolean
  /** The peak filter ProSE applied to the stored spectra (the PSM view says so); null or absent: every peak. */
  peakFilter?: PeakFilter | null
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

/** ProSE's ln(hyperscore): the name of its feature column (as the web app names it) */
const HYPERSCORE = 'ln(hyperscore)'
const PEPTDEEP_FEATURES = ['ms2_cosine', 'ms2_spectral_angle', 'ms2_pearson', 'ms2_frac_pred_found', 'rt_abs_error']

/** The columns -qpx_extended adds to the QPX psm view (besides the scores). */
const EXTENDED_COLUMNS = [
  'spectrum_reference',
  'isotope_error',
  'protein_mappings',
  'peak_mz_array',
  'peak_intensity_array',
  'predicted_ion_type_array',
  'predicted_mz_array',
  'predicted_intensity_array',
]

const first = (...values: number[]) => values.find((v) => !Number.isNaN(v)) ?? NaN

/** The larger of two numbers, ignoring NaN (C's fmax) */
const fmax = (a: number, b: number) => (Number.isNaN(a) ? b : Number.isNaN(b) ? a : Math.max(a, b))

//------------------------------------------------------------------------------
// One input's file

interface ListLeaf<T> {
  offsets: Uint32Array
  nullList: Uint8Array
  values: T
}

/** The PSM rows of one input: the columns of its QPX psm file. */
interface InputRows {
  count: number
  footer: Footer
  sequence: unknown[]
  charge: Float64Array
  pep: Float64Array
  decoy: unknown[]
  /** the scores: names as codes into `names` */
  scores: { offsets: Uint32Array; name: Int32Array; names: string[]; value: Float64Array }
  modifications: (QpxModification[] | null)[] | null
  nativeId: unknown[]
  rt: ArrayLike<number>
  observedMz: ArrayLike<number>
  calculatedMz: ArrayLike<number>
  /** QPX isotope_error (observed minus theoretical); NaN: null */
  isotope: Float64Array
  /** protein_mappings: 1-based start and end, NaN: null */
  evidence: { offsets: Uint32Array; accession: unknown[]; aa_before: unknown[]; aa_after: unknown[]; start: Float64Array; end: Float64Array }
  peakMz: ListLeaf<Float32Array>
  peakIntensity: ListLeaf<Float32Array>
  /** the ion names as codes into `ionNames` */
  ion: ListLeaf<Int32Array>
  ionNames: string[]
  predictedMz: ListLeaf<Float32Array>
  predictedIntensity: ListLeaf<Float32Array>
}

interface QpxModification {
  name: string
  accession: string | null
  positions: { position: number }[]
}

function listLeaf<T>(file: ParquetFile, column: string, mode: LeafMode = 'values'): ListLeaf<T> & { dictionary?: string[] } {
  const leaf = readLeaf(file, [column, 'list', 'element'], mode)
  return { offsets: leaf.offsets!, nullList: leaf.nullList!, values: leaf.values as T, dictionary: leaf.dictionary }
}

/** A psm file without the columns or the footer of -qpx_extended. */
class NotExtended extends Error {}

async function readInput(name: string, bytes: Uint8Array): Promise<InputRows> {
  const flat = <T>(file: ParquetFile, column: string) => readLeaf(file, [column]).values as T
  return inFile(name, async () => {
    const qpx = openParquet(bytes)
    const footer = footerOf(qpx)
    if (!footer.has('prose_files') || EXTENDED_COLUMNS.some((c) => !hasColumn(qpx, c))) {
      throw new NotExtended(`${name}: the QPX psm view has not the columns and the footer of ProSE's -qpx_extended`)
    }
    const scores = readStructList(qpx, 'additional_scores', ['score_name', 'score_value'], { score_name: 'codes' })
    const evidence = readStructList(qpx, 'protein_mappings', ['accession', 'aa_before', 'aa_after', 'start', 'end'])
    // the modifications (a list of lists): only if some row has any
    const modLeaf = readLeaf(qpx, ['modifications', 'list', 'element', 'name'])
    const modified = modLeaf.offsets![qpx.rows] > 0
    const ion = listLeaf<Int32Array>(qpx, 'predicted_ion_type_array', 'codes')
    return {
      count: qpx.rows,
      footer,
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
      nativeId: flat<unknown[]>(qpx, 'spectrum_reference'),
      rt: flat<Float32Array>(qpx, 'rt'),
      observedMz: flat<Float32Array>(qpx, 'observed_mz'),
      calculatedMz: flat<Float32Array>(qpx, 'calculated_mz'),
      isotope: flat<Float64Array>(qpx, 'isotope_error'),
      evidence: {
        offsets: evidence.offsets,
        accession: evidence.accession as unknown[],
        aa_before: evidence.aa_before as unknown[],
        aa_after: evidence.aa_after as unknown[],
        start: evidence.start as Float64Array,
        end: evidence.end as Float64Array,
      },
      peakMz: listLeaf(qpx, 'peak_mz_array'),
      peakIntensity: listLeaf(qpx, 'peak_intensity_array'),
      ion,
      // as the web app names them
      ionNames: (ion.dictionary ?? []).map(webIonName),
      predictedMz: listLeaf(qpx, 'predicted_mz_array'),
      predictedIntensity: listLeaf(qpx, 'predicted_intensity_array'),
    }
  })
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
  const several = inputs.length > 1
  await zstd

  const groupsName = 'qpx/quantms.pg.parquet'
  let perInput: (InputRows | null)[]
  let groupBytes: Uint8Array | null
  try {
    ;[perInput, groupBytes] = await Promise.all([
      Promise.all(
        inputs.map(async ({ stem }) => {
          const name = `qpx/${stem}.psm.parquet`
          const bytes = await optional(name)
          // an input whose search failed has no psm file
          return bytes ? readInput(name, bytes) : null
        }),
      ),
      optional(groupsName),
    ])
  } catch (e) {
    // the earlier layout of the app's search folders: QPX files without the columns of -qpx_extended
    if (e instanceof NotExtended || (e as { cause?: unknown })?.cause instanceof NotExtended) {
      if (await optional('summary.yaml')) throw new OldLayoutError()
    }
    throw e
  }
  const footer = perInput.find((f) => f !== null)?.footer
  if (!footer) {
    if (await optional('summary.yaml')) throw new OldLayoutError()
    throw new Error(`The search folder has no results of ProSE (qpx/<input>.psm.parquet) for any of its ${inputs.length} input(s).`)
  }
  // an input without its psm file whose search reports PSMs: its results are not under its stem (a stem
  // the shim got wrong, a file removed), and its PSMs would be left out without a word
  const perFile = inFile('the footer of the psm files', () => filesOf(footer))
  const fileEntries = await perFile
  inputs.forEach((input, k) => {
    if (perInput[k]) return
    const own = fileEntries.find((f) => f?.input_file === input.link) ?? fileEntries[k]
    const psms = own?.target_psms
    if (typeof psms === 'number' && psms > 0) {
      warnings.push(
        `${input.name}: ProSE reports ${psms} target PSMs for it, but its results (qpx/${input.stem}.psm.parquet) are not in the search folder, so its PSMs are not shown.`,
      )
    }
  })
  const decoyString = footer.get('prose_decoy_string') ?? 'DECOY_'
  const decoyIsPrefix = (footer.get('prose_decoy_position') ?? 'prefix') === 'prefix'
  const hasDecoyMarker = (accession: string) =>
    decoyString !== '' && (decoyIsPrefix ? accession.startsWith(decoyString) : accession.endsWith(decoyString))
  const proteinFdrApplied = footerFlag(footer, 'prose_protein_fdr_applied')

  //------------------------------------------------------------------------------
  // Proteins and their groups: the protein groups of the QPX pg view (several inputs: the pooled inference;
  // without protein inference, one group per protein), with the FASTA

  const accession: string[] = []
  const ownDescription: string[] = []
  const proteinQ: number[] = []
  const proteinDecoy: number[] = []
  const group: number[] = []
  const proteinRow = new Map<string, number>()
  if (groupBytes) {
    const bytes = groupBytes
    await inFile(groupsName, () => {
      const pg = openParquet(bytes)
      const members = readLeaf(pg, ['pg_accessions', 'list', 'element'])
      const names = readLeaf(pg, ['pg_names', 'list', 'element'])
      const isDecoy = readLeaf(pg, ['is_decoy']).values as unknown[]
      const groupQ = readLeaf(pg, ['global_qvalue']).values as Float64Array
      // the score of the group's first protein (the protein q-value once the protein FDR was applied)
      const scores = readStructList(pg, 'additional_scores', ['score_value'])
      const groupOf = new Map<string, number>()
      for (let r = 0; r < pg.rows; r++) {
        const from = members.offsets![r]
        const to = members.offsets![r + 1]
        const list = Array.from({ length: to - from }, (_, k) => String((members.values as unknown[])[from + k]))
        // a group of several runs has a row per run
        const key = list.join('\u0000')
        let g = groupOf.get(key)
        if (g === undefined) {
          g = groupOf.size
          groupOf.set(key, g)
        }
        const q = scores.offsets[r + 1] > scores.offsets[r] ? (scores.score_value as Float64Array)[scores.offsets[r]] : groupQ[r]
        list.forEach((a, k) => {
          if (proteinRow.has(a)) return
          proteinRow.set(a, accession.length)
          accession.push(a)
          const own = names.offsets ? (names.values as unknown[])[names.offsets[r] + k] : null
          ownDescription.push(typeof own === 'string' ? own : '')
          proteinQ.push(proteinFdrApplied ? q : NaN)
          proteinDecoy.push(hasDecoyMarker(a) || (isDecoy[r] === true && list.length === 1) ? 1 : 0)
          group.push(g)
        })
      }
    })
  }
  const proteinCount = accession.length
  let proteinsSaved = proteinCount === 0
  const description = ownDescription.slice()
  const proteinSequence = new Array<string>(proteinCount).fill('')
  const proteinScore = new Float64Array(proteinCount).fill(NaN)
  if (proteinCount > 0) {
    // the sequences and descriptions: proteins.fasta (the identified proteins), else the database (the
    // folder's database.fasta with contaminants, else the user's FASTA), else none, with a warning
    let fasta = new Map<string, FastaEntry>()
    let identified = false
    const tried: string[] = []
    const sources: [string, boolean][] = [
      ['proteins.fasta', true],
      ['database.fasta', false],
      [footer.get('prose_database_file') ?? '', false],
    ]
    let found = false
    for (const [name, own] of sources) {
      if (name === '') continue
      try {
        const bytes = await files(name)
        fasta = readFasta(utf8.decode(bytes))
        identified = own
        proteinsSaved = own
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
      enzyme: footer.get('prose_enzyme') ?? '',
      keepInitialMet: footerFlag(footer, 'prose_clip_nterm_methionine'),
      unspecific: footer.get('prose_enzyme_specificity') === 'none',
    }
    const generated = footer.get('prose_decoy_mode') === 'generated'
    for (let p = 0; p < proteinCount; p++) {
      const a = accession[p]
      const decoy = proteinDecoy[p] === 1
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

  //------------------------------------------------------------------------------
  // PSMs and their peptides

  const count = perInput.reduce((n, f) => n + (f?.count ?? 0), 0)
  let minCharge = footerNumber(footer, 'prose_min_charge', Infinity)
  let maxCharge = footerNumber(footer, 'prose_max_charge', -Infinity)
  for (const f of perInput) {
    if (!f) continue
    for (const c of f.charge) {
      minCharge = Math.min(minCharge, c)
      maxCharge = Math.max(maxCharge, c)
    }
  }

  // the features: ln(hyperscore), the standard .pin features (PercolatorInfile::getStandardFeatureSet
  // without the bookkeeping columns), the run's extra_features, PeptDeep's; those some PSM has
  const featureNames: string[] = [HYPERSCORE]
  const pin = new Set<string>()
  const addFeature = (name: string, isPin = false) => {
    if (name === '' || name === 'score' || name === HYPERSCORE || name === 'ln_hyperscore' || featureNames.includes(name)) return
    featureNames.push(name)
    if (isPin) pin.add(name)
  }
  const chargeFeatures: string[] = []
  for (let c = minCharge; Number.isFinite(c) && c <= maxCharge; c++) chargeFeatures.push(`charge${c}`)
  for (const name of ['CalcMass', 'mass', 'peplen', ...chargeFeatures, 'enzN', 'enzC', 'enzInt', 'dm', 'absdm']) addFeature(name, true)
  for (const name of (footer.get('prose_extra_features') ?? '').split(',')) addFeature(name.trim())
  for (const name of PEPTDEEP_FEATURES) addFeature(name)
  const nFeatures = featureNames.length
  const featureIndex = new Map(featureNames.map((n, j) => [n, j]))

  // the scores the columns need, by their QPX names: a slot of `values` below
  const SCORES = [
    'ln_hyperscore',
    'percolator_score',
    'global_qvalue',
    'percolator_qvalue',
    'percolator_pep',
    'precursor_mz_error_ppm',
    'isotope_error',
    'delta_mass',
  ] as const
  type ScoreName = (typeof SCORES)[number]
  const scoreSlot = new Map<string, number>(SCORES.map((n, k) => [n, k]))
  const values = new Float64Array(SCORES.length)
  const slot = (n: ScoreName) => scoreSlot.get(n)!
  const featureOfScore = new Map<string, number>()
  for (const [n, j] of featureIndex) if (!pin.has(n) && j > 0) featureOfScore.set(n, j)
  /** what a score name is for: [its slot or −1, its feature column or −1]; null: nothing */
  const uses = new Map<string, [number, number] | null>()
  const useOf = (name: string) => {
    let use = uses.get(name)
    if (use === undefined) {
      const [s, j] = [scoreSlot.get(name) ?? -1, featureOfScore.get(name) ?? -1]
      use = s < 0 && j < 0 ? null : [s, j]
      uses.set(name, use)
    }
    return use
  }
  // the columns of the .pin features
  const pinColumn = (name: string) => featureIndex.get(name)!
  const [calcMassJ, massJ, peplenJ, enzNJ, enzCJ, enzIntJ, dmJ, absdmJ] = ['CalcMass', 'mass', 'peplen', 'enzN', 'enzC', 'enzInt', 'dm', 'absdm'].map(pinColumn)
  const chargeColumns = chargeFeatures.map(pinColumn)
  const [hyperscoreS, percolatorScoreS, qS, percolatorQS, percolatorPepS, precursorErrorS, isotopeErrorS, deltaMassS] = SCORES.map(slot)
  const enzyme = pinEnzymeName(footer.get('prose_enzyme') ?? '')

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
    const scoreUses = f.scores.names.map(useOf)
    for (let r = 0; r < f.count; r++, i++) {
      psmFile[i] = fileIndex
      nativeId[i] = String(f.nativeId[r] ?? '')
      rt[i] = f.rt[r]
      const observed = f.observedMz[r]
      const calc = f.calculatedMz[r]
      mz[i] = observed
      const z = f.charge[r]
      charge[i] = clampInt8(z)
      decoy[i] = f.decoy[r] === true ? 1 : 0

      // the scores and the features among them
      values.fill(NaN)
      const row = i * nFeatures
      for (let k = f.scores.offsets[r]; k < f.scores.offsets[r + 1]; k++) {
        const c = f.scores.name[k]
        const use = c < 0 ? null : scoreUses[c]
        if (use === null) continue
        const v = f.scores.value[k]
        if (use[0] >= 0) values[use[0]] = v
        if (use[1] >= 0 && !Number.isNaN(v)) {
          features[row + use[1]] = v
          featurePresent[use[1]] = 1
        }
      }
      const hyperscore = values[hyperscoreS]
      const percolator = values[percolatorScoreS]
      const s = Number.isNaN(percolator) ? hyperscore : percolator
      score[i] = s
      qValue[i] = first(values[qS], values[percolatorQS])
      pep[i] = first(f.pep[r], values[percolatorPepS])
      // the isotope error of QPX (observed minus theoretical); the one Percolator saw (ProSE's meta value) for dm
      const isotope = f.isotope[r]
      isotopeError[i] = clampInt8(isotope)
      const corrected = observed - ((Number.isNaN(isotope) ? 0 : isotope) * C13C12_MASSDIFF_U) / z
      precursorErrorPpm[i] = first(values[precursorErrorS], calc > 0 ? ((corrected - calc) / calc) * 1e6 : NaN)
      deltaMass[i] = values[deltaMassS]
      features[row] = hyperscore

      // the .pin features (PercolatorInfile::stampPinFeaturesOnHits); none for a hit without a protein
      const sequence = String(f.sequence[r] ?? '')
      const e0 = f.evidence.offsets[r]
      if (f.evidence.offsets[r + 1] > e0) {
        const iso = Math.fround(first(values[isotopeErrorS], isotope))
        const dm = (Number.isNaN(iso) ? observed : observed - (iso * C13C12_MASSDIFF_U) / z) - calc
        // a protein terminus ('-' in QPX) as OpenMS' '[' and ']', which Percolator's features were computed with
        const before = f.evidence.aa_before[e0] === '-' ? '[' : String(f.evidence.aa_before[e0] ?? '')
        const after = f.evidence.aa_after[e0] === '-' ? ']' : String(f.evidence.aa_after[e0] ?? '')
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
      // its proteins: the protein mappings of its first PSM whose protein is a row of the proteins
      for (let e = e0; e < f.evidence.offsets[r + 1]; e++) {
        const p = proteinRow.get(String(f.evidence.accession[e]))
        if (p === undefined) continue // a protein the protein FDR removed
        const protein = proteinSequence[p]
        // 1-based first and last position -> 0-based
        let from = f.evidence.start[e] - 1
        let to = f.evidence.end[e] - 1
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
      qValue: Float64Array.from(proteinQ),
      decoy: Uint8Array.from(proteinDecoy),
      group: Int32Array.from(group),
    },
  }

  //------------------------------------------------------------------------------
  // Spectra and predictions: the columns of the PSM rows

  const { spectra, predicted } = spectraOf(perInput, count)
  const top = footerNumber(footer, 'prose_peak_top', 0)
  const peakFilter = top > 0 ? { top, window: footerNumber(footer, 'prose_peak_window', 0) } : null

  //------------------------------------------------------------------------------
  // Summary

  let modificationAnalysis: ProSESummary['modificationAnalysis'] = null
  const deltaName = footer.get('prose_mod_analysis_delta_masses')
  const ptmName = footer.get('prose_mod_analysis_ptms')
  if (footerFlag(footer, 'prose_open_search') && deltaName && ptmName) {
    const [deltas, ptms] = await Promise.all([optional(`mods/${deltaName}`), optional(`mods/${ptmName}`)])
    if (deltas && ptms) {
      modificationAnalysis = await inFile(`mods/{${deltaName},${ptmName}}`, () =>
        parseModificationAnalysis(utf8.decode(deltas), utf8.decode(ptms)),
      )
    }
  }
  const summary = await inFile('the footer of the psm files', () => toSummary(footer, paths, modificationAnalysis))
  return { summary, tables, spectra, predicted, warnings, proteinsSaved, peakFilter }
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

/** StoredSpectra (one spectrum per PSM row with peaks) and PredictedSpectra of the PSM rows. */
function spectraOf(perInput: (InputRows | null)[], count: number): { spectra: StoredSpectra; predicted: PredictedSpectra } {
  let peakCount = 0
  let spectrumCount = 0
  let ionCount = 0
  for (const f of perInput) {
    if (!f) continue
    for (let r = 0; r < f.count; r++) {
      if (!f.peakMz.nullList[r]) {
        spectrumCount++
        peakCount += f.peakMz.offsets[r + 1] - f.peakMz.offsets[r]
      }
      if (!f.ion.nullList[r]) ionCount += f.ion.offsets[r + 1] - f.ion.offsets[r]
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
    for (let r = 0; r < f.count; r++, i++) {
      psmOffsets[i] = ions
      // (element by element: a PSM has tens of peaks, too few for subarray() and set())
      if (!f.peakMz.nullList[r]) {
        const from = f.peakMz.offsets[r]
        const n = f.peakMz.offsets[r + 1] - from
        const intensityFrom = f.peakIntensity.offsets[r]
        for (let k = 0; k < n; k++) {
          mz[peak + k] = f.peakMz.values[from + k]
          intensity[peak + k] = f.peakIntensity.values[intensityFrom + k]
        }
        peak += n
        precursorMz[spectrum] = f.observedMz[r]
        psmSpectrum[i] = spectrum++
        offsets[spectrum] = peak
      }
      if (!f.ion.nullList[r]) {
        const from = f.ion.offsets[r]
        const n = f.ion.offsets[r + 1] - from
        const mzFrom = f.predictedMz.offsets[r]
        const intensityFrom = f.predictedIntensity.offsets[r]
        for (let k = 0; k < n; k++) {
          const c = f.ion.values[from + k]
          ion[ions + k] = c < 0 ? '' : f.ionNames[c]
          predictedMz[ions + k] = f.predictedMz.values[mzFrom + k]
          predictedIntensity[ions + k] = f.predictedIntensity.values[intensityFrom + k]
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
