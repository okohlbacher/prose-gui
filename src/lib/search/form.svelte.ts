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
 * The example: OpenMS' small E. coli run (Ecoli_MS2_small.mzML: LTQ Orbitrap XL, CID, 139 MS2 spectra) searched
 * twice as two replicates of condition "example", against the E. coli K-12 proteins (targets only: ProSE makes
 * the decoys). The shim gives the bundled run under the two names. Its fragments are measured in the ion trap,
 * so the example sets the fragment tolerance to 0.5 Da; everything else is the preset's.
 */
export const EXAMPLE = {
  names: ['Ecoli_1.mzML', 'Ecoli_2.mzML'],
  fasta: 'Ecoli_K12_proteome.fasta',
  condition: 'example',
  parameters: { 'fragment:mass_tolerance': 0.5, 'fragment:mass_tolerance_unit': 'Da' },
} as const

/** What "Remove all" or "Start over" removed: the rows, the database (Start over), the notices, the example's settings. */
export type Removed = {
  files: FileRow[]
  database: DatabaseChoice | null
  notices: string[]
  /** The example's settings the removal replaced, and the values it put in (Undo restores only over those). */
  parameters: Record<string, unknown>
  replacedWith: Record<string, unknown>
}

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
  /** Paths being inspected (the rows come when their sizes and counts are known). */
  adding = $state(0)
  /** Files are being added or the example is loading: Remove all and Start over wait. */
  busy = $derived(this.adding > 0 || this.exampleLoading)
  /** What the last "Remove all" or "Start over" removed, for its Undo (until files or a database are chosen again). */
  removed = $state<Removed | null>(null)
  /** The example's settings (EXAMPLE.parameters) are in force: set by loadExample, the example's files still there. */
  #exampleSettings = $state(false)
  /**
   * The example's own settings are in force and unchanged, so that leaving the example gives back the preset's (Start
   * over's tooltip says so); a tolerance the user set since stays (`#leaveExample`).
   */
  get exampleSettingsActive(): boolean {
    return this.#exampleSettings && Object.entries(EXAMPLE.parameters).every(([name, value]) => sameValue(this.values[name], value))
  }

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
    this.#exampleSettings = false
    this.presetId = id
    this.overrides = copyValues(preset.parameters)
  }

  /** Saves the settings that differ from ProSE's defaults as a user preset and selects it. */
  saveAsPreset(name: string): Preset {
    // (the settings become the user's own: the example's no longer go back when its files go)
    this.#exampleSettings = false
    const preset = savePreset(name, changedParameters($state.snapshot(this.values), this.defaults))
    this.presets = loadPresets()
    this.presetId = preset.id
    this.overrides = copyValues(preset.parameters)
    return preset
  }


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
      // (rows join: the example's settings end, an Undo of a removal is no longer offered)
      if (facts.some((f) => f.error === null)) {
        this.#leaveExample()
        this.removed = null
      }
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
    this.#leaveExample()
  }

  /** "Remove all" of the Spectra card: no files, and none of the notices about them (Undo brings them back). */
  removeAllFiles() {
    if (this.busy) return
    this.#remove(false)
  }

  /**
   * "Start over": no files and no database; the settings (preset, parameters, rescoring) as they are, but for the
   * example's own (its fragment tolerance), which go back to the preset's. Undo brings everything back.
   */
  startOver() {
    if (this.busy) return
    this.#remove(true)
  }

  #remove(database: boolean) {
    const removed: Removed = {
      files: this.files,
      database: database ? this.database : null,
      notices: this.notices,
      ...this.#leaveExampleWithUndo(),
    }
    if (removed.files.length > 0 || removed.database) this.removed = removed
    this.files = []
    this.notices = []
    if (database) this.database = null
  }

  /** Undo of the last "Remove all" or "Start over". */
  undoRemove() {
    const r = this.removed
    if (!r || this.busy) return
    this.removed = null
    this.files = [...r.files, ...this.files]
    this.notices = r.notices
    if (r.database) {
      this.database = r.database
      // a database whose count the removal cut short is counted again
      if (r.database.proteins === null && r.database.error === null) void this.setDatabase(r.database.file.path, { example: true })
    }
    // the example's settings come back unless the user set others since the removal
    const names = Object.keys(r.parameters)
    if (names.length > 0 && names.every((name) => sameValue(this.values[name], r.replacedWith[name]))) {
      for (const name of names) this.overrides[name] = copyValue(r.parameters[name])
      this.#exampleSettings = true
    }
  }

  /** `#leaveExample` for a removal: the example's values it replaced and what it put in their place. */
  #leaveExampleWithUndo(): { parameters: Record<string, unknown>; replacedWith: Record<string, unknown> } {
    const parameters = this.#leaveExample()
    const replacedWith = Object.fromEntries(Object.keys(parameters).map((name) => [name, copyValue(this.values[name])]))
    return { parameters, replacedWith }
  }

  /**
   * The example's files are gone or joined by others: its own settings go back to the preset's (or ProSE's
   * defaults), unless the user changed one of them since (then they are the user's: a tolerance and its unit go
   * together). Returns the example's values it replaced.
   */
  #leaveExample(): Record<string, unknown> {
    if (!this.#exampleSettings) return {}
    this.#exampleSettings = false
    const example = Object.entries(EXAMPLE.parameters)
    if (!example.every(([name, value]) => sameValue(this.values[name], value))) return {}
    const preset = this.preset?.parameters ?? {}
    const replaced: Record<string, unknown> = {}
    for (const [name, value] of example) {
      replaced[name] = value
      if (name in preset) this.overrides[name] = copyValue(preset[name])
      else delete this.overrides[name]
    }
    return replaced
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

  /**
   * Chooses the FASTA at `path` as the database; its proteins and residues are counted by the shim. Another
   * database than the example's ends the example's settings.
   */
  async setDatabase(path: string, options: { example?: boolean } = {}) {
    if (!options.example) this.#leaveExample()
    this.removed = null
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

  /** Loads the example (two replicates of one file and its FASTA, its fragment tolerance) in place of the current files. */
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
      this.removed = null
      for (const f of facts) this.#addRow(f, { condition: EXAMPLE.condition })
      void this.setDatabase(example.database, { example: true })
      // the example's own settings, and the protein FDR of the preset (or ProSE's default) whatever it was
      for (const [name, value] of Object.entries(EXAMPLE.parameters)) this.setParam(name, value)
      const preset = this.preset?.parameters ?? {}
      this.setParam('FDR:protein', 'FDR:protein' in preset ? preset['FDR:protein'] : this.defaults['FDR:protein'])
      this.#exampleSettings = true
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
