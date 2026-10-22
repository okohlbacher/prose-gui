// The New search form: files with their design fields, the database, the settings and the rescoring
// switches. Kept outside the view so that it survives a visit to another view. Files are paths (the
// system's dialog, drag and drop, the example), never read by the page: the shim's `inspect_files`
// gives their sizes and counts.

import { resolveDesign, type DesignInput } from '../design/model'
import type { DesignFields, DesignUpdate } from '../design/paste'
import { errorText, exampleFiles, inspectFiles, type FileFacts, type InputFile } from '../desktop'
import { changedParameters, copyValue, copyValues, defaultsOf, sameValue, type ParamEntry } from '../settings/parameters'
import { BUILTIN_PRESETS, DEFAULT_PRESET_ID, loadPresets, savePreset, type Preset } from '../settings/presets'
import { PROSE_PARAMETERS } from '../settings/prose'
import { formatBytes } from '../format/bytes'
import { isFasta, isMzML } from './files'

export type FileRow = DesignFields & {
  id: string
  file: InputFile
  /** From the mzML header; null if the header does not say (and for .mzML.gz). */
  spectra: number | null
}

/**
 * The database: its proteins and residues once counted (null while counting), or why it could not be
 * read (`error`; the search cannot start then).
 */
export type DatabaseChoice = { file: InputFile; proteins: number | null; residues: number | null; error: string | null }

/** The entries of the bundled cRAP FASTA (`src-tauri/resources/fasta/crap.fasta`), and their residues. */
export const CRAP_PROTEINS = 116
export const CRAP_RESIDUES = 38459

/**
 * The example: one mzML searched twice as two replicates of condition "example", with its FASTA (the
 * shim gives the bundled run under the two names). Its database is small (49 proteins): with a decoy
 * ranked first, no protein q-value goes below 1/49, so the example is searched at a protein FDR of 5 %.
 */
export const EXAMPLE = {
  names: ['DatabaseSuitability_1.mzML', 'DatabaseSuitability_2.mzML'],
  fasta: 'DatabaseSuitability_database.fasta',
  condition: 'example',
  proteinFdr: 0.05,
} as const

/** The name of a path's file (either separator). */
export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

let nextId = 0

function toInput(row: FileRow): DesignInput {
  return {
    id: row.id,
    fileName: row.file.name,
    fileSize: row.file.size,
    condition: row.condition,
    replicate: row.replicate,
    fraction: row.fraction,
    techReplicate: row.techReplicate,
  }
}

class SearchForm {
  files = $state<FileRow[]>([])
  database = $state<DatabaseChoice | null>(null)
  contaminants = $state(true)
  presets = $state<Preset[]>(loadPresets())
  presetId = $state(DEFAULT_PRESET_ID)
  /** The parameters set by the preset and the user, on top of ProSE's defaults. */
  overrides = $state<Record<string, unknown>>(
    copyValues(BUILTIN_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!.parameters),
  )
  rescore = $state(true)
  peptdeep = $state(false)
  /** The design table shows Tech. replicate, Fraction group and Sample. */
  advanced = $state(false)
  /** What adding, pasting or loading could not use. */
  notices = $state<string[]>([])
  exampleLoading = $state(false)

  /** Threads of the search (Advanced); null: all cores. */
  threads = $state<number | null>(null)
  /** The Advanced area of the settings is open. */
  advancedSettings = $state(false)

  /** ProSE's parameters by name (generated from the pinned tool). */
  entries = new Map(PROSE_PARAMETERS.map((e) => [e.name, e]))
  defaults: Record<string, unknown> = defaultsOf(PROSE_PARAMETERS)
  values = $derived<Record<string, unknown>>({ ...this.defaults, ...this.overrides })
  design = $derived(resolveDesign(this.files.map(toInput)))
  /** The files and the database are the bundled example's. */
  isExample = $derived(
    this.files.length === EXAMPLE.names.length &&
      this.files.every((r, i) => r.file.name === EXAMPLE.names[i]) &&
      this.database?.file.name === EXAMPLE.fasta,
  )
  preset = $derived(this.presets.find((p) => p.id === this.presetId) ?? null)
  /** The settings differ from the preset's. */
  modified = $derived.by(() => {
    const preset = this.preset?.parameters ?? {}
    return Object.keys({ ...preset, ...this.overrides }).some(
      (name) => !sameValue(this.values[name], name in preset ? preset[name] : this.defaults[name]),
    )
  })

  entry(name: string): ParamEntry | undefined {
    return this.entries.get(name)
  }

  value<T = unknown>(name: string): T {
    return this.values[name] as T
  }

  setParam(name: string, value: unknown) {
    this.overrides[name] = copyValue(value)
  }

  choosePreset(id: string) {
    const preset = this.presets.find((p) => p.id === id)
    if (!preset) return
    this.presetId = id
    this.overrides = copyValues(preset.parameters)
  }

  /** Saves the settings that differ from ProSE's defaults as a user preset and selects it. */
  saveAsPreset(name: string): Preset {
    const preset = savePreset(name, changedParameters($state.snapshot(this.values), this.defaults))
    this.presets = loadPresets()
    this.presetId = preset.id
    this.overrides = copyValues(preset.parameters)
    return preset
  }

  /** Paths being inspected (the rows come when their sizes and counts are known). */
  adding = $state(0)

  /**
   * Adds mzML files (by path) to the table; a FASTA becomes the database; anything else is reported.
   * Resolves when the rows are there.
   */
  async addFiles(paths: Iterable<string>) {
    const list = [...paths]
    const skipped = list.filter((p) => !isMzML(fileName(p)) && !isFasta(fileName(p))).map(fileName)
    const spectra = list.filter((p) => isMzML(fileName(p)))
    const database = list.filter((p) => isFasta(fileName(p))).pop()
    if (skipped.length > 0) {
      this.notices.push(
        `Not an mzML file: ${skipped.join(', ')}. Convert vendor files to mzML first, e.g. with ProteoWizard msconvert.`,
      )
    }
    if (database !== undefined) void this.setDatabase(database)
    if (spectra.length === 0) return
    this.adding++
    try {
      const facts = await inspectFiles(spectra)
      const unreadable = facts.filter((f) => f.error !== null)
      for (const f of facts) if (f.error === null) this.#addRow(f, {})
      if (unreadable.length > 0) this.notices.push(...unreadable.map((f) => `${f.name}: ${f.error}`))
    } catch (e) {
      this.notices.push(`The files could not be added (${errorText(e)}).`)
    } finally {
      this.adding--
    }
  }

  #addRow(facts: FileFacts, fields: DesignFields) {
    const id = `f${++nextId}`
    const file: InputFile = { path: facts.path, name: facts.name, size: facts.size }
    this.files.push({ id, file, spectra: facts.spectra, ...fields })
  }

  removeFile(id: string) {
    this.files = this.files.filter((r) => r.id !== id)
  }

  /** "Remove all" of the Spectra card: no files, and none of the notices about them. */
  removeAllFiles() {
    this.files = []
    this.notices = []
  }

  /** "Start over": no files and no database, the settings (preset, parameters, rescoring) as they are. */
  startOver() {
    this.removeAllFiles()
    this.database = null
  }

  setField<K extends keyof DesignFields>(id: string, field: K, value: DesignFields[K]) {
    const row: DesignFields | undefined = this.files.find((r) => r.id === id)
    if (row) row[field] = value
  }

  /** Pasted or loaded design fields for rows of the table. */
  applyUpdates(updates: DesignUpdate[]) {
    for (const { index, fields } of updates) {
      const row = this.files[index]
      if (row) Object.assign(row, fields)
    }
  }

  /** Chooses the FASTA at `path` as the database; its proteins and residues are counted by the shim. */
  async setDatabase(path: string) {
    const file: InputFile = { path, name: fileName(path), size: 0 }
    const choice: DatabaseChoice = { file, proteins: null, residues: null, error: null }
    this.database = choice
    let error: string | null = null
    let facts: FileFacts | null = null
    try {
      facts = (await inspectFiles([path]))[0]
      error = facts.error
    } catch (e) {
      error = errorText(e)
    }
    // (another database may have been chosen meanwhile)
    if (this.database?.file.path !== path) return
    // (without a final period: it goes into the app's own sentence)
    if (error !== null || !facts) this.database = { ...choice, error: (error ?? 'unknown').replace(/\.$/, '') }
    else this.database = { file: { ...file, size: facts.size }, proteins: facts.proteins, residues: facts.residues, error: null }
  }

  /** Loads the example (two replicates of one file and its FASTA) in place of the current files. */
  async loadExample() {
    if (this.exampleLoading) return
    this.exampleLoading = true
    try {
      const example = await exampleFiles()
      const facts = await inspectFiles(example.spectra)
      const broken = facts.find((f) => f.error !== null)
      if (broken) throw new Error(broken.error!)
      this.files = []
      this.notices = []
      for (const f of facts) this.#addRow(f, { condition: EXAMPLE.condition })
      void this.setDatabase(example.database)
      this.setParam('FDR:protein', EXAMPLE.proteinFdr)
    } catch (e) {
      this.notices.push(`The example could not be loaded (${errorText(e).replace(/\.$/, '')}).`)
    } finally {
      this.exampleLoading = false
    }
  }

  /** "6 files · 1.9 GB" */
  get filesLine(): string {
    const bytes = this.files.reduce((sum, r) => sum + r.file.size, 0)
    return `${this.files.length} ${this.files.length === 1 ? 'file' : 'files'} · ${formatBytes(bytes)}`
  }
}

export const searchForm = new SearchForm()
