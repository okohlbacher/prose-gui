// The SDRF loaded into New search: the file as it is (`SdrfTable`, written back with the table's edits by
// "Save SDRF…"), where each of its data files is, and the rows of the design table they became. A data file
// is looked for beside the SDRF, then below a folder the user chose ("Locate folder…", remembered per SDRF),
// or picked by hand ("Locate…"). Found files join the table as if added; the search waits for the others.

import {
  cancelDownload,
  chooseFile,
  chooseFolder,
  downloadDataFiles,
  errorText,
  locateDataFiles,
  openDesignFile,
  prideFiles,
  type DownloadProgress,
} from '../desktop'
import { isSpectrum } from '../search/files'
import { fileName, searchForm as form } from '../search/form.svelte'
import { parseDesignTsv } from './design-tsv'
import type { DesignInput } from './model'
import { applyDesign } from './paste'
import { parseSdrf } from './sdrf'
import { accessionOf, downloadPlan } from './sdrf-download'
import { exportSdrf, SAMPLE_COLUMNS } from './sdrf-export'
import { APP_VERSION } from '../history/history'
import {
  cell,
  column,
  dataRows,
  noValue,
  parseSdrfTable,
  syncDesign,
  validateSdrf,
  writeSdrfTable,
  type SdrfIssue,
  type SdrfTable,
} from './sdrf-table'

/**
 * found: the file named; mzml: an mzML of the same stem (the vendor file named is not there, or ProSE cannot read
 * it); vendor: only a vendor file ProSE cannot read (convert it to mzML); remote: not here, but the SDRF has its
 * comment[file uri]; missing: nowhere.
 */
export type FileStatus = 'found' | 'mzml' | 'vendor' | 'remote' | 'missing'

export type SdrfFile = { name: string; status: FileStatus; path: string | null; uri: string }

export const STATUS_TEXT: Record<FileStatus, string> = {
  found: 'Found',
  mzml: 'Found as mzML',
  vendor: 'Vendor file only: convert it to mzML',
  remote: 'Not here; the SDRF has its download address',
  missing: 'Missing',
}

/** The status of the data file `name` from what `locate_data_files` found. */
export function fileStatus(name: string, located: { exact: string | null; mzml: string | null }, uri: string): Omit<SdrfFile, 'name' | 'uri'> {
  if (located.exact && isSpectrum(name)) return { status: 'found', path: located.exact }
  if (located.mzml) return { status: 'mzml', path: located.mzml }
  if (located.exact) return { status: 'vendor', path: located.exact }
  return { status: uri !== '' && !noValue(uri) ? 'remote' : 'missing', path: null }
}

const FIELDS = ['condition', 'replicate', 'fraction', 'techReplicate'] as const
type Fields = Partial<Pick<DesignInput, (typeof FIELDS)[number]>>

/**
 * The design fields (`parseSdrf`: condition from the factor values, replicates, fraction) that differ between two
 * versions of an SDRF, per data file; a field no longer given is `undefined`.
 */
export function designChanges(before: SdrfTable, after: SdrfTable): { fileName: string; fields: Fields }[] {
  const old = new Map(parseSdrf(writeSdrfTable(before)).inputs.map((i) => [i.fileName!, i]))
  return parseSdrf(writeSdrfTable(after)).inputs.flatMap((now) => {
    const was = old.get(now.fileName!) ?? {}
    const fields: Fields = {}
    for (const f of FIELDS) if (now[f] !== was[f]) (fields as Record<string, unknown>)[f] = now[f]
    return Object.keys(fields).length > 0 ? [{ fileName: now.fileName!, fields }] : []
  })
}

const FOLDERS = 'prose.sdrf.folders'

function rememberedFolder(sdrf: string): string | null {
  try {
    return (JSON.parse(localStorage.getItem(FOLDERS) ?? '{}') as Record<string, string>)[sdrf] ?? null
  } catch {
    return null
  }
}

function rememberFolder(sdrf: string, folder: string) {
  try {
    const all = JSON.parse(localStorage.getItem(FOLDERS) ?? '{}') as Record<string, string>
    all[sdrf] = folder
    localStorage.setItem(FOLDERS, JSON.stringify(all))
  } catch {
    // (a convenience only)
  }
}

class SdrfSession {
  /** The SDRF's path; null: none loaded. */
  path = $state<string | null>(null)
  table = $state.raw<SdrfTable | null>(null)
  issues = $state.raw<SdrfIssue[]>([])
  /** One per distinct comment[data file], in SDRF order. */
  files = $state<SdrfFile[]>([])
  folder = $state<string | null>(null)
  busy = $state(false)
  /** The user chose to search without the files that are not found. */
  skipMissing = $state(false)
  /** The ProteomeXchange accession the missing files are looked up under (from the SDRF, or typed). */
  pxd = $state('')
  /** The running download; its error. */
  download = $state<DownloadProgress | null>(null)
  downloadError = $state<string | null>(null)
  /** Columns still to fill in (a created SDRF's sample columns, "not available" until then). */
  toFill = $state<string[]>([])
  /** The design fields of each data file as loaded, by its name. */
  #loaded = new Map<string, Partial<DesignInput>>()

  name = $derived(this.path ? fileName(this.path) : '')
  /** The `toFill` columns that some row still has as "not available". */
  stillToFill = $derived(
    this.table ? this.toFill.filter((h) => dataRows(this.table!).some((r) => noValue(cell(this.table!, r, column(this.table!, h))))) : [],
  )
  unresolved = $derived(this.files.filter((f) => f.status === 'vendor' || f.status === 'remote' || f.status === 'missing'))

  /** Why the search cannot start (the plan line): data files that are not found. */
  problem = $derived.by(() => {
    if (this.busy) return `Looking for the data files of ${this.name}…`
    const n = this.unresolved.length
    if (n === 0 || this.skipMissing) return null
    const shown = this.unresolved.slice(0, 2).map((f) => f.name).join(', ')
    const more = n > 2 ? ` and ${n - 2} more` : ''
    return `${n} ${n === 1 ? 'data file' : 'data files'} of ${this.name} not found or not readable (${shown}${more}). Locate them, or search without them.`
  })

  /** The SDRF file of a row of the design table (by its path), or undefined for a file added by hand. */
  fileAt(path: string): SdrfFile | undefined {
    return this.files.find((f) => f.path === path)
  }

  async load(path: string, text: string) {
    const table = parseSdrfTable(text)
    const fileCol = column(table, 'comment[data file]')
    const uriCol = column(table, 'comment[file uri]')
    this.path = path
    this.table = table
    this.issues = validateSdrf(table)
    this.skipMissing = false
    this.toFill = []
    this.#loaded = new Map(parseSdrf(text).inputs.map((i) => [i.fileName!, i]))
    const seen = new Set<string>()
    this.files = []
    for (const r of dataRows(table)) {
      const name = cell(table, r, fileCol)
      if (name === '' || seen.has(name)) continue
      seen.add(name)
      this.files.push({ name, status: 'missing', path: null, uri: cell(table, r, uriCol) })
    }
    const notices = parseSdrf(text).notices.map((n) => `${this.name}: ${n.message}`)
    form.notices.push(...notices)
    this.folder = rememberedFolder(path)
    this.pxd = accessionOf(table, fileName(path))
    this.downloadError = null
    await this.#resolve()
  }

  /**
   * "Create SDRF…": an SDRF of the files in the table (`exportSdrf` of the design, with the technical columns
   * of the settings), opened as if loaded; its sample columns are to be filled in.
   */
  create() {
    const instruments = Object.fromEntries(form.files.filter((r) => r.instrument).map((r) => [r.file.name, r.instrument!]))
    const text = exportSdrf(null, form.design, { values: $state.snapshot(form.values) as Record<string, unknown>, appVersion: APP_VERSION, instruments })
    const table = parseSdrfTable(text)
    this.path = 'experiment.sdrf.tsv'
    this.table = table
    this.issues = validateSdrf(table)
    this.skipMissing = false
    this.folder = null
    this.toFill = [...SAMPLE_COLUMNS]
    this.#loaded = new Map(parseSdrf(text).inputs.map((i) => [i.fileName!, i]))
    this.files = form.files.map((r) => ({ name: r.file.name, status: 'found', path: r.file.path, uri: '' }))
  }

  /** Changes the SDRF (the metadata editor): `change` edits a copy, which is then checked again. */
  update(change: (t: SdrfTable) => void) {
    if (!this.table) return
    const table = structuredClone(this.table)
    change(table)
    // the design fields the edit changed go to the design table (the SDRF is the reference for both)
    for (const { fileName: name, fields } of designChanges(this.table, table)) {
      const row = form.files.find((r) => r.file.path === this.files.find((f) => f.name === name)?.path)
      if (!row) continue
      for (const [field, value] of Object.entries(fields)) form.setField(row.id, field as keyof typeof fields, value as never)
    }
    this.#loaded = new Map(parseSdrf(writeSdrfTable(table)).inputs.map((i) => [i.fileName!, i]))
    this.table = table
    this.issues = validateSdrf(table)
  }

  /** The design table's edits written into the SDRF itself (before the metadata editor shows it). */
  commitDesign() {
    if (!this.table) return
    const table = parseSdrfTable(this.text())
    this.#loaded = new Map(parseSdrf(writeSdrfTable(table)).inputs.map((i) => [i.fileName!, i]))
    this.table = table
    this.issues = validateSdrf(table)
  }

  /**
   * "Download missing": the data files that are not here (and their associated files), from their file URIs or the
   * project's files in PRIDE, into a folder the user chooses; then the files are looked for again.
   */
  async downloadMissing() {
    if (!this.table || !this.path || this.download) return
    this.downloadError = null
    const names = this.unresolved.filter((f) => f.status !== 'vendor').map((f) => f.name)
    try {
      const pride = /^(PXD|MSV)\d+$/.test(this.pxd.trim()) ? await prideFiles(this.pxd.trim()) : []
      const plan = downloadPlan(this.table, names, pride)
      if (plan.files.length === 0) {
        this.downloadError = `No download address for ${plan.notFound.join(', ')}. ${this.pxd ? `PRIDE's ${this.pxd} does not list them.` : 'Enter the ProteomeXchange accession (PXD…).'}`
        return
      }
      const folder = await chooseFolder(`Download ${plan.files.length} ${plan.files.length === 1 ? 'file' : 'files'} into…`)
      if (!folder) return
      this.download = { file: 0, files: plan.files.length, name: plan.files[0].name, received: 0, size: plan.files[0].size }
      await downloadDataFiles(plan.files, folder, (p) => (this.download = p))
      if (plan.notFound.length > 0) this.downloadError = `Not found anywhere: ${plan.notFound.join(', ')}.`
      this.folder = folder
      rememberFolder(this.path, folder)
      this.download = null
      await this.#resolve()
    } catch (e) {
      this.downloadError = errorText(e)
    } finally {
      this.download = null
    }
  }

  cancelDownload() {
    void cancelDownload()
  }

  /** "Locate folder…": looks for the data files below a folder the user chooses. */
  async locateFolder() {
    if (!this.path) return
    const folder = await chooseFolder(`Where are the data files of ${this.name}?`)
    if (!folder) return
    this.folder = folder
    rememberFolder(this.path, folder)
    await this.#resolve()
  }

  /** "Locate…" of one data file: the user picks it. */
  async locateFile(name: string) {
    const path = await chooseFile(`Locate ${name}`)
    if (!path) return
    const file = this.files.find((f) => f.name === name)
    if (!file) return
    Object.assign(file, { status: isSpectrum(fileName(path)) ? 'found' : 'vendor', path })
    await this.#addFound()
  }

  /** Forgets the SDRF (its rows stay in the table as files added by hand). */
  clear() {
    this.path = null
    this.table = null
    this.issues = []
    this.files = []
    this.toFill = []
    this.#loaded = new Map()
  }

  async #resolve() {
    if (!this.path) return
    this.busy = true
    try {
      const located = await locateDataFiles(this.path, this.files.map((f) => f.name), this.folder)
      this.files.forEach((f, i) => Object.assign(f, fileStatus(f.name, located[i], f.uri)))
      await this.#addFound()
    } catch (e) {
      form.notices.push(`${this.name}: the data files could not be looked for (${errorText(e)}).`)
    } finally {
      this.busy = false
    }
  }

  /** Found files join the table (as `addFiles` would add them) with the SDRF's design fields. */
  async #addFound() {
    // (rows already in the table keep their fields: the user may have changed them)
    const listed = new Set(form.files.map((r) => r.file.path))
    const usable = this.files.filter((f) => f.path && !listed.has(f.path) && (f.status === 'found' || f.status === 'mzml'))
    if (usable.length === 0) return
    await form.addFiles(usable.map((f) => f.path!))
    for (const f of usable) {
      const row = form.files.find((r) => r.file.path === f.path)
      const fields = this.#loaded.get(f.name)
      if (row && fields) {
        const { fileName: _n, ...rest } = fields
        form.setField(row.id, 'condition', rest.condition)
        form.setField(row.id, 'replicate', rest.replicate)
        form.setField(row.id, 'fraction', rest.fraction)
        form.setField(row.id, 'techReplicate', rest.techReplicate)
      }
    }
  }

  /** The SDRF with the design table's edits in its own columns (`syncDesign`), as text. */
  text(): string {
    if (!this.table) return ''
    const table = structuredClone(this.table)
    const design = form.design
    syncDesign(
      table,
      this.files.flatMap((f) => {
        const i = form.files.findIndex((r) => r.file.path === f.path)
        if (i < 0 || !design.rows[i]) return []
        const r = form.files[i]
        return [
          {
            fileName: f.name,
            before: this.#loaded.get(f.name) ?? {},
            after: { condition: r.condition, replicate: r.replicate, fraction: r.fraction, techReplicate: r.techReplicate },
            resolved: design.rows[i],
          },
        ]
      }),
    )
    return writeSdrfTable(table)
  }
}

export const sdrfSession = new SdrfSession()

/**
 * "Load design (SDRF, design.tsv)" in the app: the open dialog, then an SDRF (by its header) is loaded with its
 * files (`sdrfSession.load`), a design.tsv gives the fields of the files in the table (matched by name).
 */
export async function openDesign() {
  const chosen = await openDesignFile()
  if (!chosen) return
  const header = chosen.text.replace(/^﻿/, '').split(/\r\n|\n|\r/, 1)[0].toLowerCase()
  if (header.includes('comment[data file]') || header.includes('source name')) {
    await sdrfSession.load(chosen.path, chosen.text)
    return
  }
  const parsed = parseDesignTsv(chosen.text)
  const applied = applyDesign(parsed.inputs, form.files.map((r) => r.file.name))
  form.applyUpdates(applied.rows)
  form.notices.push(...[...parsed.notices.map((n) => n.message), ...applied.notices].map((m) => `${fileName(chosen.path)}: ${m}`))
}
