// Reading ProSE's Parquet files (Arrow C++, Zstandard) with hyparquet.
//
// hyparquet assembles nested columns into one JavaScript object per list element: for the OMS psm file
// of a large search (150,000 PSMs with ~30 meta values each) that is millions of objects and seconds of
// garbage collection. The reader needs the columns, not the objects, so `readLeaf` decodes one leaf
// column with hyparquet's page decoders (its exported `src/*.js` modules) and keeps it flat: one value
// per row, or per element of a list of one level, with the offsets of the rows' lists. Lists of lists
// (QPX `modifications`) are read with hyparquet as objects (`readObjects`), which is cheap for them.
// The OMS psm file has its meta values as text (millions of them, hardly ever repeated): `numeric` reads
// such a column as numbers straight from the page, without a string or a view per value.

import { parquetMetadata, parquetReadObjects, parquetSchema } from 'hyparquet'
import type { Compressors, DecodedArray, FileMetaData, SchemaTree } from 'hyparquet'
import { parquetHeader } from 'hyparquet/src/column.js'
import { convert, convertWithDictionary, DEFAULT_PARSERS } from 'hyparquet/src/convert.js'
import { decompressPage, readDataPage, readDataPageV2 } from 'hyparquet/src/datapage.js'
import { readRleBitPackedHybrid } from 'hyparquet/src/encoding.js'
import { readPlain } from 'hyparquet/src/plain.js'
import { getTreePath } from 'hyparquet/src/schema.js'
import { decompress } from 'fzstd'
import { ZSTDDecoder } from 'zstddec'

// Zstandard, which ProSE's Parquet files use (hyparquet has Snappy only): zstd itself in WebAssembly
// (zstddec), ten times as fast as the JavaScript port fzstd, which is the fallback where WebAssembly
// cannot start (a Content-Security-Policy without 'wasm-unsafe-eval', or without data: for connect-src,
// from where zstddec loads its module).
let wasm: ZSTDDecoder | null = null
let starting: Promise<void> | null = null

/** Starts the WebAssembly decoder (once); without it, ZSTD decodes with fzstd. */
export function startZstd(): Promise<void> {
  starting ??= (async () => {
    try {
      const decoder = new ZSTDDecoder()
      await decoder.init()
      wasm = decoder
    } catch (e) {
      wasm = null
      console.warn(`Zstandard: the WebAssembly decoder (zstddec) did not start, the reader uses fzstd, about ten times slower (${e instanceof Error ? e.message : String(e)}).`)
    }
  })()
  return starting
}

/** Decompresses a Zstandard page of `outputLength` bytes. */
export const ZSTD = (input: Uint8Array, outputLength: number): Uint8Array =>
  wasm ? wasm.decode(input, outputLength) : decompress(input, new Uint8Array(outputLength))
const compressors: Compressors = { ZSTD }

export interface ParquetFile {
  bytes: Uint8Array
  buffer: ArrayBuffer
  metadata: FileMetaData
  tree: SchemaTree
  rows: number
}

export function openParquet(bytes: Uint8Array): ParquetFile {
  const buffer =
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer
      ? bytes.buffer
      : (bytes.slice().buffer as ArrayBuffer)
  const metadata = parquetMetadata(buffer)
  return { bytes: new Uint8Array(buffer), buffer, metadata, tree: parquetSchema(metadata), rows: Number(metadata.num_rows) }
}

/** Whether the file has the top-level column `name`. */
export function hasColumn(file: ParquetFile, name: string): boolean {
  return file.tree.children.some((c) => c.element.name === name)
}

/**
 * A leaf column. Flat (offsets null): one value per row. In a list (offsets set): the elements of row r
 * are offsets[r] .. offsets[r + 1] of values.
 */
export interface Leaf<T> {
  rows: number
  offsets: Uint32Array | null
  /** list columns: 1 where the row's list is null (not merely empty) */
  nullList: Uint8Array | null
  /** one per row or element; absent values are null, or NaN in a numeric column, or −1 (codes) */
  values: T
  /** mode 'codes': the strings of the codes */
  dictionary?: string[]
}

/**
 * How a leaf is read: as it is ('values'); a string column as numbers ('numbers': Float64Array, NaN
 * where a string is not a number, without making the strings); a string column with few distinct
 * strings as codes ('codes': Int32Array of indices into `dictionary`, −1: absent).
 */
export type LeafMode = 'values' | 'numbers' | 'codes'

type Values = Float64Array | Float32Array | Int32Array | unknown[]

/** The numbers of a leaf: FLOAT as Float32Array, DOUBLE and INT32 as Float64Array (NaN: absent); else null. */
function makeNumbers(type: string | undefined, length: number, numeric: boolean): Float64Array | Float32Array | null {
  if (type === 'FLOAT') return new Float32Array(length).fill(NaN)
  if (type === 'DOUBLE' || type === 'INT32' || numeric) return new Float64Array(length).fill(NaN)
  return null
}

/** 10^0 … 10^22, the powers of ten a double has exactly */
const POW10 = Array.from({ length: 23 }, (_, k) => Number(`1e${k}`))

/**
 * The number spelled by the ASCII bytes `b[start..end)`, as JavaScript's Number() reads it (NaN: not a
 * number). Decimals with powers of ten up to 22 directly: of up to 15 significant digits the same double
 * as Number() (one correctly rounded operation), of 16 to 19 within a few units in the last place (the
 * meta values are text of doubles rounded to 15 to 17 digits anyway). Others through a string.
 */
export function parseNumber(b: Uint8Array, start: number, end: number): number {
  let i = start
  let negative = false
  if (i < end && (b[i] === 45 || b[i] === 43)) negative = b[i++] === 45
  let mantissa = 0
  let digits = 0
  let exponent = 0
  let any = false
  for (; i < end && b[i] >= 48 && b[i] <= 57; i++, any = true) {
    if (mantissa !== 0 || b[i] !== 48) {
      mantissa = mantissa * 10 + (b[i] - 48)
      digits++
    }
  }
  if (i < end && b[i] === 46) {
    for (i++; i < end && b[i] >= 48 && b[i] <= 57; i++, any = true, exponent--) {
      if (mantissa !== 0 || b[i] !== 48) {
        mantissa = mantissa * 10 + (b[i] - 48)
        digits++
      }
    }
  }
  if (any && i < end && (b[i] === 101 || b[i] === 69)) {
    let j = i + 1
    let sign = 1
    if (j < end && (b[j] === 45 || b[j] === 43)) sign = b[j++] === 45 ? -1 : 1
    let e = 0
    const from = j
    for (; j < end && b[j] >= 48 && b[j] <= 57; j++) e = e * 10 + (b[j] - 48)
    if (j > from) {
      exponent += sign * e
      i = j
    }
  }
  if (any && i === end && digits <= 19 && exponent >= -22 && exponent <= 22) {
    const v = exponent < 0 ? mantissa / POW10[-exponent] : mantissa * POW10[exponent]
    return negative ? -v : v
  }
  // anything else (more digits, 'inf', text): as Number() reads the string
  if (end - start === 0) return NaN
  const text = String.fromCharCode.apply(null, b.subarray(start, end) as unknown as number[]).trim()
  return text === '' ? NaN : Number(text)
}

/** PLAIN BYTE_ARRAY values (4-byte length, bytes) as numbers. */
function plainNumbers(page: Uint8Array, offset: number, count: number): Float64Array {
  const view = new DataView(page.buffer, page.byteOffset, page.byteLength)
  const out = new Float64Array(count)
  for (let k = 0; k < count; k++) {
    const length = view.getUint32(offset, true)
    offset += 4
    out[k] = parseNumber(page, offset, offset + length)
    offset += length
  }
  return out
}

const bitWidth = (value: number) => 32 - Math.clz32(value)

interface NumericPage {
  definitionLevels: number[]
  repetitionLevels: number[]
  dataPage: Float64Array
}

/**
 * A data page of a BYTE_ARRAY column as numbers (`readLeaf`, `numeric`): its levels as hyparquet reads
 * them, its values (PLAIN, or indices into `dictionary`) parsed from the page's bytes.
 */
function numericPage(
  pageBytes: Uint8Array,
  header: ReturnType<typeof parquetHeader>,
  codec: Parameters<typeof decompressPage>[2],
  maxRep: number,
  maxDef: number,
  dictionary: Float64Array | undefined,
): NumericPage {
  let page: Uint8Array
  let reader: { view: DataView; offset: number }
  let n: number
  let encoding: string
  const repetitionLevels: number[] = []
  const definitionLevels: number[] = []
  if (header.type === 'DATA_PAGE' && header.data_page_header) {
    const h = header.data_page_header
    page = decompressPage(pageBytes, header.uncompressed_page_size, codec, compressors)
    reader = { view: new DataView(page.buffer, page.byteOffset, page.byteLength), offset: 0 }
    n = h.num_values
    encoding = h.encoding
    if (maxRep) {
      repetitionLevels.length = n
      readRleBitPackedHybrid(reader, bitWidth(maxRep), repetitionLevels)
    }
    if (maxDef) {
      definitionLevels.length = n
      readRleBitPackedHybrid(reader, bitWidth(maxDef), definitionLevels)
    }
  } else if (header.type === 'DATA_PAGE_V2' && header.data_page_header_v2) {
    const h = header.data_page_header_v2
    n = h.num_values
    encoding = h.encoding
    const levels = { view: new DataView(pageBytes.buffer, pageBytes.byteOffset, pageBytes.byteLength), offset: 0 }
    if (maxRep) {
      repetitionLevels.length = n
      readRleBitPackedHybrid(levels, bitWidth(maxRep), repetitionLevels, h.repetition_levels_byte_length)
    }
    levels.offset = h.repetition_levels_byte_length
    if (maxDef) {
      definitionLevels.length = n
      readRleBitPackedHybrid(levels, bitWidth(maxDef), definitionLevels, h.definition_levels_byte_length)
    }
    const levelBytes = h.repetition_levels_byte_length + h.definition_levels_byte_length
    page = pageBytes.subarray(levelBytes)
    if (h.is_compressed !== false) page = decompressPage(page, header.uncompressed_page_size - levelBytes, codec, compressors)
    reader = { view: new DataView(page.buffer, page.byteOffset, page.byteLength), offset: 0 }
  } else {
    throw new Error(`numericPage: page type ${header.type}`)
  }
  let present = n
  if (maxDef) for (let k = 0; k < n; k++) if (definitionLevels[k] !== maxDef) present--
  let dataPage: Float64Array
  if (encoding === 'PLAIN') {
    dataPage = plainNumbers(page, reader.offset, present)
  } else if (encoding === 'PLAIN_DICTIONARY' || encoding === 'RLE_DICTIONARY') {
    if (!dictionary) throw new Error('numericPage: a dictionary page is missing')
    const width = reader.view.getUint8(reader.offset++)
    const indices = new Array<number>(present)
    if (width) readRleBitPackedHybrid(reader, width, indices, page.byteLength - reader.offset)
    else indices.fill(0)
    dataPage = new Float64Array(present)
    for (let k = 0; k < present; k++) dataPage[k] = dictionary[indices[k]]
  } else {
    throw new Error(`numericPage: encoding ${encoding}`)
  }
  // as hyparquet: no definition levels when every value is there
  if (present === n) definitionLevels.length = 0
  return { definitionLevels, repetitionLevels, dataPage }
}

/**
 * Reads the leaf column at `path` (e.g. ['psm_metavalues', 'list', 'element', 'name']) of every row
 * group, as `mode` says. Leaves under at most one repeated level only.
 */
export function readLeaf<T extends Values = Values>(file: ParquetFile, path: string[], mode: LeafMode = 'values'): Leaf<T> {
  const schemaPath = getTreePath(file.tree, path)
  const element = schemaPath[schemaPath.length - 1].element
  let maxDef = 0
  let maxRep = 0
  let elementDef = 0 // the definition level at which a list element exists
  for (const node of schemaPath.slice(1)) {
    const repetition = node.element.repetition_type
    if (repetition !== 'REQUIRED') maxDef++
    if (repetition === 'REPEATED') {
      maxRep++
      elementDef = maxDef
    }
  }
  if (maxRep > 1) throw new Error(`readLeaf: ${path.join('.')} is a list of lists`)
  const listed = maxRep === 1

  const key = path.join('\u0000')
  const chunks = file.metadata.row_groups.map((group) => {
    const chunk = group.columns.find((c) => c.meta_data?.path_in_schema.join('\u0000') === key)
    if (!chunk?.meta_data) throw new Error(`readLeaf: no column ${path.join('.')}`)
    return chunk.meta_data
  })
  // an upper bound of the elements: every level entry is at most one
  const entries = chunks.reduce((n, c) => n + Number(c.num_values), 0)
  // numbers in a typed array, anything else (strings, booleans, bigints) in an array (null: absent)
  const asNumbers = mode === 'numbers' && element.type === 'BYTE_ARRAY'
  const asCodes = mode === 'codes' && element.type === 'BYTE_ARRAY'
  const numbers = asCodes
    ? new Int32Array(listed ? entries : file.rows).fill(-1)
    : makeNumbers(element.type, listed ? entries : file.rows, asNumbers)
  // codes: the strings, and the code of each
  const strings: string[] = []
  const codeOf = new Map<string, number>()
  const code = (s: unknown) => {
    const key = String(s)
    let c = codeOf.get(key)
    if (c === undefined) {
      c = strings.length
      strings.push(key)
      codeOf.set(key, c)
    }
    return c
  }
  const others: unknown[] = numbers ? [] : new Array(listed ? entries : file.rows)
  let o = 0
  const offsets = listed ? new Uint32Array(file.rows + 1) : null
  const nullList = listed ? new Uint8Array(file.rows) : null
  let row = 0
  let count = 0 // elements (list) so far

  for (const meta of chunks) {
    const decoder = {
      pathInSchema: path,
      type: meta.type,
      element,
      schemaPath,
      codec: meta.codec,
      parsers: DEFAULT_PARSERS,
      compressors,
      utf8: true,
    }
    let start = Number(meta.dictionary_page_offset ?? meta.data_page_offset)
    if (!start || Number(meta.data_page_offset) < start) start = Number(meta.data_page_offset)
    const bytes = file.bytes.subarray(start, start + Number(meta.total_compressed_size))
    const reader = { view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset: 0 }
    let dictionary: DecodedArray | undefined
    let seen = 0
    const total = Number(meta.num_values)
    while (seen < total && reader.offset < bytes.byteLength) {
      const header = parquetHeader(reader)
      const pageBytes = bytes.subarray(reader.offset, reader.offset + header.compressed_page_size)
      reader.offset += header.compressed_page_size
      if (header.type === 'DICTIONARY_PAGE') {
        const page = decompressPage(pageBytes, header.uncompressed_page_size, meta.codec, compressors)
        const pageReader = { view: new DataView(page.buffer, page.byteOffset, page.byteLength), offset: 0 }
        const n = header.dictionary_page_header?.num_values ?? 0
        const plain = readPlain(pageReader, meta.type, n, element.type_length)
        dictionary = asNumbers
          ? Float64Array.from(plain as Uint8Array[], (b) => parseNumber(b, 0, b.length))
          : asCodes
            ? Int32Array.from(convert(plain, decoder) as string[], code)
            : convert(plain, decoder)
        continue
      }
      let page
      let encoding
      if (asNumbers && (header.type === 'DATA_PAGE' || header.type === 'DATA_PAGE_V2')) {
        page = numericPage(pageBytes, header, meta.codec, maxRep, maxDef, dictionary as Float64Array | undefined)
        encoding = 'PLAIN' // the values are numbers already
      } else if (header.type === 'DATA_PAGE' && header.data_page_header) {
        const raw = decompressPage(pageBytes, header.uncompressed_page_size, meta.codec, compressors)
        page = readDataPage(raw, header.data_page_header, decoder)
        encoding = header.data_page_header.encoding
      } else if (header.type === 'DATA_PAGE_V2' && header.data_page_header_v2) {
        page = readDataPageV2(pageBytes, header, decoder)
        encoding = header.data_page_header_v2.encoding
      } else {
        continue // an index page
      }
      let data
      if (asNumbers) data = page.dataPage
      else if (asCodes && dictionary && encoding.endsWith('_DICTIONARY')) {
        const indices = page.dataPage
        data = new Int32Array(indices.length)
        for (let k = 0; k < indices.length; k++) data[k] = (dictionary as Int32Array)[indices[k] as number]
      } else if (asCodes) data = Int32Array.from(convert(page.dataPage, decoder) as string[], code)
      else data = convertWithDictionary(page.dataPage, dictionary, encoding as Parameters<typeof convertWithDictionary>[2], decoder)
      const def = page.definitionLevels ?? []
      const rep = page.repetitionLevels ?? []
      const n = Math.max(def.length, rep.length, data.length)
      const allDefined = def.length === 0
      let v = 0
      if (listed) {
        for (let k = 0; k < n; k++) {
          const d = allDefined ? maxDef : def[k]
          if (rep[k] === 0) {
            offsets![row] = count
            if (d < elementDef - 1) nullList![row] = 1
            row++
          }
          if (d >= elementDef) {
            if (numbers) {
              if (d === maxDef) numbers[count] = data[v++] as number
            } else {
              others[o++] = d === maxDef ? data[v++] : null
            }
            count++
          }
        }
      } else if (numbers) {
        for (let k = 0; k < n; k++, row++) if (allDefined || def[k] === maxDef) numbers[row] = data[v++] as number
      } else {
        for (let k = 0; k < n; k++, row++) others[o++] = allDefined || def[k] === maxDef ? data[v++] : null
      }
      seen += n
    }
  }
  if (row !== file.rows) throw new Error(`readLeaf: ${path.join('.')} has ${row} rows, the file ${file.rows}`)
  if (offsets) offsets[file.rows] = count
  others.length = o
  const values = numbers ? (listed ? numbers.subarray(0, count) : numbers) : others
  return { rows: file.rows, offsets, nullList, values: values as T, dictionary: asCodes ? strings : undefined }
}

/** The leaves `fields` of the list of structs `column` (`column.list.element.<field>`). */
export function readStructList<F extends string>(
  file: ParquetFile,
  column: string,
  fields: F[],
  modes: Partial<Record<F, LeafMode>> = {},
): { offsets: Uint32Array; nullList: Uint8Array; dictionaries: Partial<Record<F, string[]>> } & Record<F, Values> {
  const out: Record<string, unknown> = {}
  const dictionaries: Partial<Record<F, string[]>> = {}
  let offsets: Uint32Array | null = null
  let nullList: Uint8Array | null = null
  for (const field of fields) {
    const leaf = readLeaf(file, [column, 'list', 'element', field], modes[field])
    if (leaf.dictionary) dictionaries[field] = leaf.dictionary
    offsets ??= leaf.offsets
    nullList ??= leaf.nullList
    out[field] = leaf.values
  }
  return { ...out, offsets: offsets!, nullList: nullList!, dictionaries } as never
}

/** The rows of `columns` as hyparquet assembles them (for small or rarely filled nested columns). */
export async function readObjects(file: ParquetFile, columns: string[]): Promise<Record<string, unknown>[]> {
  return parquetReadObjects({ file: file.buffer, columns, compressors })
}
