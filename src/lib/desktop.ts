// The desktop bridge: the only module that talks to Tauri (the shim's commands and events, the
// system's dialogs, drag and drop from the file manager). Everything else of the app works with the
// plain types below, so that the screens stay the web app's and the tests need no Tauri.
//
// Commands (src-tauri/src/lib.rs): tool_info, start_search, cancel_search, read_search_file,
// inspect_files, cpu_count, example_files, save_text, save_search_file, history_list, history_save_record,
// history_save_proteins, history_rename, history_delete, history_files, history_import, open_project_file,
// save_project_file, open_design_file, locate_data_files, answer_close, save_project_setup, open_project_setup, forget_project_setup, menu_state. Events:
// search://progress, search://done, search://failed, project://progress, app://close-requested, menu://action. The system's dialogs open one at a time (`oneDialog`). The window's
// theme (`windowTheme`, `onWindowThemeChanged`, `setWindowTheme`).

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import { oneDialog } from './dialogs'
import type { HistoryBackend, HistoryEntry } from './history/history'
import type { ByteRange, SearchFiles } from './results/read'
import { errorText } from './format/error'

/** The ProSE tool the app runs: its version, where it is, and whether it has ONNX Runtime (PeptDeep). */
/** `sdrf`: the tool has -sdrf (the QPX run and sample views from an SDRF). */
/** `inspect`: the tool has -inspect_out (ProSE's own spectrum inspector; the app reads the mzML flags itself until then). */
export type ToolInfo = { version: string; path: string; onnx: boolean; sdrf?: boolean; inspect?: boolean }

/**
 * What the first MS2 spectra of an mzML say, by their flags (src-tauri/src/spectra.rs; guidance G1): not
 * verified against the peaks. `source` 'prose' is for ProSE's own inspector (-inspect_out) once the tool has it.
 */
export type SpectraFacts = {
  source?: 'flags' | 'prose'
  peakPicking: boolean
  analyzers: string[]
  /** Spectra read per MS level ("1", "2", ...). */
  levels: Record<string, number>
  /** The whole spectrum list was read (the counts are the file's). */
  complete: boolean
  ms2Centroid: number
  ms2Profile: number
  ms2WithCharge: number
  ms2WithPrecursor: number
  activation: Record<string, number>
  isolationCentres: number
  isolationWidth: number | null
  ms2Analyzer: Record<string, number>
  filter: string | null
}

/** A file the user chose, by path (never read by the page; the shim reads it where it is). */
export type InputFile = { path: string; name: string; size: number }

/** What New search shows of a file (`inspect_files`): sizes and counts, never contents. */
export type FileFacts = InputFile & {
  /** The spectra of an mzML's header (null: not said). */
  spectra: number | null
  /** The entries of a FASTA and the residues of their sequences. */
  proteins: number | null
  residues: number | null
  /** Why the file cannot be used (missing, unreadable). */
  error: string | null
  /**
   * Why ProSE cannot search the file, which is there (src-tauri/src/content.rs): an mzML that is not one, is cut off
   * or has no spectra; a FASTA without entries, with an accession twice, a protein too long. Sentences, the file named.
   */
  problem: string | null
  /** What ProSE treats specially (a FASTA's entries listed twice, which it searches once): sentences, not blocking. */
  warnings: string[]
  /** An mzML's instrument model from its header (PSI-MS). */
  instrument?: { name: string; accession: string } | null
  /** A FASTA's entries in numbers (src-tauri/src/content.rs `FastaSummary`; guidance G6). */
  fasta?: FastaSummary | null
}

/** A FASTA's entries in numbers: organisms (OS=), UniProt headers, isoforms, contaminants, decoys and their marker. */
export type FastaSummary = {
  /** [organism, entries], most entries first (at most 5). */
  organisms: [string, number][]
  withOrganism: number
  organismCount: number
  uniprot: number
  isoforms: number
  contaminants: number
  decoys: number
  decoyMarker: string | null
}

/** The search request of the shim (src-tauri/src/args.rs `SearchRequest`, camelCase). */
export type SearchRequest = {
  files: { id: string; path: string }[]
  database: string
  contaminants: boolean
  settings: {
    /** ProSE's `Search:` parameters by name without the prefix (args.rs `PARAMETERS`). */
    parameters: Record<string, unknown>
    rescore: boolean
    peptdeep: boolean
    /** `-threads`; 0: all cores. */
    threads: number
  }
  /** The SDRF of the inputs, passed to a tool that has -sdrf (`ToolInfo.sdrf`). */
  sdrf?: string
}

/** A step of a running search (`search://progress`). */
export type SearchProgress = { label: string; file: number; fraction: number }

/** What `search://failed` says beyond the message (src-tauri/src/run.rs `FailedEvent`). */
export type FailureDetails = {
  /** How ProSE ended: "ProSE crashed (signal 11, SIGSEGV)", "ProSE ended with exit code 3". */
  ended?: string
  /** ProSE's last lines on stderr. */
  detail?: string
  /** Where the search's whole log was kept (`logs/last-failure.log` of the app's data). */
  log?: string
}

/** How a search ended badly (`search://failed`): ProSE's message, the step and the file, and how it ended. */
export class SearchFailed extends Error {
  constructor(
    message: string,
    readonly stage: string,
    readonly file: number,
    readonly details: FailureDetails = {},
  ) {
    super(message)
    this.name = 'SearchFailed'
  }
}

/**
 * A search that has started: its id, how it ends (the folder of its outputs), and `stop` to stop
 * listening to it (after a cancel, which sends neither done nor failed).
 */
export type RunningSearch = { searchId: string; done: Promise<{ folder: string }>; stop: () => void }

/** The app runs in Tauri (not in a plain browser, e.g. `vite dev` without the shell). */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function toolInfo(): Promise<ToolInfo> {
  return invoke<ToolInfo>('tool_info')
}

type ProgressPayload = SearchProgress & { searchId: string }
type DonePayload = { searchId: string; folder: string }
type FailedPayload = { searchId: string; message: string; stage: string; file?: number } & FailureDetails

/**
 * Starts a search. The events of the search go to `onProgress` until it ends; `done` resolves with
 * its folder or rejects with `SearchFailed`. Events are listened to before the search starts, so none
 * is missed; those of other searches are ignored. A cancelled search (`cancelSearch`) sends neither
 * done nor failed, unless it finished just before the cancel reached it (then done comes).
 */
export async function startSearch(request: SearchRequest, onProgress: (p: SearchProgress) => void): Promise<RunningSearch> {
  let id: string | null = null
  // events that come before start_search has answered (the first ones, with the id still unknown)
  const early: { kind: 'progress' | 'done' | 'failed'; payload: ProgressPayload | DonePayload | FailedPayload }[] = []
  let settle: { resolve: (d: { folder: string }) => void; reject: (e: Error) => void } | null = null
  const done = new Promise<{ folder: string }>((resolve, reject) => (settle = { resolve, reject }))
  const unlisten: UnlistenFn[] = []
  const stop = () => unlisten.splice(0).forEach((u) => u())

  const handle = (kind: 'progress' | 'done' | 'failed', payload: ProgressPayload | DonePayload | FailedPayload) => {
    if (id === null) {
      early.push({ kind, payload })
      return
    }
    if (payload.searchId !== id) return
    if (kind === 'progress') {
      const p = payload as ProgressPayload
      onProgress({ label: p.label, file: p.file, fraction: p.fraction })
    } else if (kind === 'done') {
      stop()
      settle!.resolve({ folder: (payload as DonePayload).folder })
    } else {
      const f = payload as FailedPayload
      stop()
      settle!.reject(new SearchFailed(f.message, f.stage, f.file ?? -1, { ended: f.ended, detail: f.detail, log: f.log }))
    }
  }

  unlisten.push(
    await listen<ProgressPayload>('search://progress', (e) => handle('progress', e.payload)),
    await listen<DonePayload>('search://done', (e) => handle('done', e.payload)),
    await listen<FailedPayload>('search://failed', (e) => handle('failed', e.payload)),
  )
  try {
    const started = await invoke<{ searchId: string }>('start_search', { request })
    id = started.searchId
  } catch (e) {
    stop()
    throw new Error(errorText(e))
  }
  for (const { kind, payload } of early.splice(0)) handle(kind, payload)
  return { searchId: id, done, stop }
}

/** Ends a running search; resolves when its process is gone (a finished or unknown id is fine). */
export function cancelSearch(searchId: string): Promise<void> {
  return invoke('cancel_search', { searchId })
}

/** A file of a search's folder (all of it, or the bytes of `range`): the command read_search_file. */
async function readSearchFile(searchId: string, name: string, range?: ByteRange): Promise<Uint8Array> {
  const part = !range ? {} : 'tail' in range ? { tail: range.tail } : { offset: range.offset, length: range.length }
  return new Uint8Array(await invoke<ArrayBuffer>('read_search_file', { searchId, name, ...part }))
}

/**
 * The files of a search for the results reader (`readSearch`): its folder's files by relative name,
 * and the database it was searched with (its database.json) by absolute path. A missing file rejects with
 * `{ notFound: true, message }`.
 */
export function searchFiles(searchId: string): SearchFiles {
  return (name, range) => readSearchFile(searchId, name, range)
}

/** Sizes and counts of files given by path (the open dialog, drag and drop, the example). */
export function inspectFiles(paths: string[]): Promise<FileFacts[]> {
  // the page's browser mode reads no file: each is missing (Re-run of a result then names them, as for moved files)
  if (!isDesktop()) {
    return Promise.resolve(
      paths.map((path) => ({ path, name: path.split(/[\\/]/).pop() ?? path, size: 0, spectra: null, proteins: null, residues: null, error: 'not readable in the browser', problem: null, warnings: [] })),
    )
  }
  return invoke<FileFacts[]>('inspect_files', { paths })
}

/** What the first MS2 spectra of each mzML say (null: not an mzML), off the add-files path. */
export function inspectSpectra(paths: string[]): Promise<(SpectraFacts | null)[]> {
  return invoke<(SpectraFacts | null)[]>('inspect_spectra', { paths })
}

/** The cores the search's threads may use (`navigator.hardwareConcurrency` is capped by the webview). */
export function cpuCount(): Promise<number> {
  return invoke<number>('cpu_count')
}

/** The bundled example: the run as two named files, and its FASTA. */
export function exampleFiles(): Promise<{ spectra: string[]; database: string }> {
  return invoke('example_files')
}

/**
 * The system's open dialog for spectra (several: mzML, mzPeak, Thermo .raw, and Bruker .d folders by their analysis.tdf,
 * as the system's file dialog picks files or folders, not both) or a database; the chosen paths ([] if cancelled).
 */
export function chooseFiles(kind: 'spectra' | 'database'): Promise<string[]> {
  return oneDialog<string[]>([], async () => {
    const chosen = await open(
      kind === 'spectra'
        ? {
            multiple: true,
            title: 'Add files: spectra, a FASTA database, an SDRF or design.tsv (for a Bruker .d folder, choose its analysis.tdf)',
            filters: [
              { name: 'Spectra, FASTA, SDRF', extensions: ['mzML', 'mzml', 'gz', 'mzpeak', 'raw', 'tdf', 'fasta', 'fa', 'faa', 'tsv', 'txt', 'sdrf'] },
              { name: 'Spectra (mzML, mzPeak, Thermo .raw, Bruker analysis.tdf)', extensions: ['mzML', 'mzml', 'gz', 'mzpeak', 'raw', 'tdf'] },
            ],
          }
        : { multiple: false, title: 'Choose a FASTA database', filters: [{ name: 'FASTA', extensions: ['fasta', 'fa', 'faa'] }] },
    )
    if (chosen === null) return []
    return Array.isArray(chosen) ? chosen : [chosen]
  })
}

/**
 * Files dragged from the file manager onto the window: `over` while they are above it (true) or have
 * left (false), `drop` with their paths. Returns the way to stop listening.
 */
export async function onFileDrop(handlers: { over: (on: boolean) => void; drop: (paths: string[]) => void }): Promise<() => void> {
  if (!isDesktop()) return () => {}
  return getCurrentWebview().onDragDropEvent((event) => {
    const p = event.payload
    if (p.type === 'enter' || p.type === 'over') handlers.over(true)
    else if (p.type === 'leave') handlers.over(false)
    else if (p.type === 'drop') {
      handlers.over(false)
      handlers.drop(p.paths)
    }
  })
}

/**
 * The page's browser mode (`vite dev` without the shell, the browser UI tests of e2e-web/): a save is the browser's
 * download of `name`, which resolves with the name (there is no path).
 */
function browserDownload(name: string, blob: Blob): string {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return name
}

/**
 * Saves text (CSV, design.tsv, SVG) where the user chooses in the system's save dialog, suggesting
 * `name`. Resolves with the path, or null if the user cancelled.
 */
export function saveText(name: string, contents: string): Promise<string | null> {
  if (!isDesktop()) return Promise.resolve(browserDownload(name, new Blob([contents], { type: 'text/plain;charset=utf-8' })))
  return oneDialog(null, () => invoke<string | null>('save_text', { name, contents }))
}

/** A UniProt proteome of an organism NCBI Taxonomy found by name. */
export type ProteomeHit = { upid: string; organism: string; taxid: number; rank: string; proteins: number; reference: boolean; strain: string }

/** The UniProt proteomes of the organisms NCBI Taxonomy finds for `name` (reference proteomes first). */
export function findProteomes(name: string): Promise<ProteomeHit[]> {
  return invoke<ProteomeHit[]>('find_proteomes', { name })
}

/** The file names of the proteomes downloaded before (the app's databases folder). */
export function downloadedProteomes(): Promise<string[]> {
  return invoke<string[]>('downloaded_proteomes')
}

/** Opens an https link in the system's browser (the Help page). */
export function openUrl(url: string): Promise<void> {
  return invoke('open_url', { url })
}

/** UniProt's reference proteome `proteome` as a FASTA in the app's databases folder (downloaded once): its path. */
export function downloadProteome(proteome: string, reviewed: boolean): Promise<string> {
  return invoke<string>('download_proteome', { proteome, reviewed })
}

/** Binary contents (an .xlsx) written where the user chooses, suggesting `name`; the path, or null if cancelled. */
export function saveBytes(name: string, contents: Uint8Array): Promise<string | null> {
  if (!isDesktop()) return Promise.resolve(browserDownload(name, new Blob([contents as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' })))
  return oneDialog(null, () => invoke<string | null>('save_bytes', contents, { headers: { 'x-file-name': encodeURIComponent(name) } }))
}

/** Copies a file of a search (e.g. `merged.idXML`) to where the user chooses, suggesting `suggested`. */
export function saveSearchFile(searchId: string, name: string, suggested: string): Promise<string | null> {
  return oneDialog(null, () => invoke<string | null>('save_search_file', { searchId, name, suggested }))
}

/** A QPX results folder the user chose (ProSE run by hand): its runs' stems and its run and provenance views; null if cancelled. */
export function openQpxFolder(): Promise<{ folder: string; stems: string[]; run: Uint8Array; provenance: Uint8Array } | null> {
  return oneDialog(null, async () => {
    const r = await invoke<{ folder: string; stems: string[]; run: number[]; provenance: number[] } | null>('open_qpx_folder')
    return r && { ...r, run: Uint8Array.from(r.run), provenance: Uint8Array.from(r.provenance) }
  })
}

/** The QPX folder as a new search in History, with its record and inputs.json: the new id. */
export function importQpxFolder(folder: string, record: string, inputs: string): Promise<string> {
  return invoke<string>('history_import_qpx', { folder, record, inputs })
}

/**
 * History's disk: the Rust commands (src-tauri/src/history.rs). A project file is written by the Rust side
 * (src-tauri/src/project.rs); an opened one and the entries of an import go as raw bodies, not as JSON numbers.
 */
export const desktopBackend: HistoryBackend = {
  list: () => invoke<HistoryEntry[]>('history_list'),
  read: readSearchFile,
  saveRecord: (searchId, record) => invoke('history_save_record', { searchId, record }),
  saveProteins: (searchId, proteins) => invoke('history_save_proteins', { searchId, proteins }),
  rename: (searchId, name) => invoke('history_rename', { searchId, name }),
  delete: (searchId) => invoke('history_delete', { searchId }),
  files: (searchId) => invoke('history_files', { searchId }),
  // the dialog and the writing are one command: the zip goes to disk entry by entry, `project://progress` says how far
  saveProject: (searchId, name, onProgress) =>
    oneDialog(null, async () => {
      const unlisten = onProgress
        ? await listen<{ searchId: string; written: number; total: number }>('project://progress', (e) => {
            if (e.payload.searchId === searchId) onProgress(e.payload.total > 0 ? e.payload.written / e.payload.total : 1)
          })
        : null
      try {
        return await invoke<string | null>('save_project_file', { searchId, name })
      } finally {
        unlisten?.()
      }
    }),
  // the dialog and the read are one command: the page never names a path (cancelled: an empty body)
  openProject: () =>
    oneDialog(null, async () => {
      const bytes = new Uint8Array(await invoke<ArrayBuffer>('open_project_file'))
      return bytes.length === 0 ? null : bytes
    }),
  importEntries: (body) => invoke<string>('history_import', body),
}

/**
 * The window's close button while a search runs: the app keeps the window and asks (`app://close-requested`);
 * `handler` shows the question. Returns the way to stop listening.
 */
export async function onCloseRequested(handler: () => void): Promise<() => void> {
  if (!isDesktop()) return () => {}
  return listen('app://close-requested', () => handler())
}

/** The window's theme as the system gives it (null outside Tauri, or when it cannot be read). */
export async function windowTheme(): Promise<'light' | 'dark' | null> {
  if (!isDesktop()) return null
  try {
    return await getCurrentWindow().theme()
  } catch {
    return null
  }
}

/** Changes of the window's theme (the system's, or the one `setWindowTheme` sets). Returns the way to stop listening. */
export async function onWindowThemeChanged(handler: (theme: 'light' | 'dark') => void): Promise<() => void> {
  if (!isDesktop()) return () => {}
  return getCurrentWindow().onThemeChanged(({ payload }) => handler(payload))
}

/**
 * The theme of the window itself (its title bar, the system's dialogs): light or dark, or null to follow
 * the system again. A failure is ignored (the page has its theme either way).
 */
export async function setWindowTheme(theme: 'light' | 'dark' | null): Promise<void> {
  if (!isDesktop()) return
  try {
    await getCurrentWindow().setTheme(theme)
  } catch {
    // e.g. a platform without it
  }
}

/** The answer to a close request: close (the running search ends), or keep the window. */
export function answerClose(close: boolean): Promise<void> {
  return invoke('answer_close', { close })
}

/** The text of a rejection of a command (a string, or an object with a message). */
export { errorText }

/** An SDRF or design.tsv chosen in the system's open dialog: its path and text; null if cancelled. */
/** The text of an SDRF or design.tsv the user gave by path (Add files, drop). */
export function readDesignFile(path: string): Promise<string> {
  return invoke<string>('read_design_file', { path })
}

export function openDesignFile(): Promise<{ path: string; text: string } | null> {
  return oneDialog(null, () => invoke<{ path: string; text: string } | null>('open_design_file'))
}

/** Where the data files an SDRF names are (src-tauri/src/locate.rs): beside the SDRF, then below `folder`. */
export function locateDataFiles(sdrf: string, names: string[], folder: string | null): Promise<{ exact: string | null; mzml: string | null }[]> {
  return invoke('locate_data_files', { sdrf, names, folder })
}

/** The system's folder dialog; the folder chosen, or null. */
export function chooseFolder(title: string): Promise<string | null> {
  return oneDialog(null, async () => {
    const chosen = await open({ directory: true, multiple: false, title })
    return typeof chosen === 'string' ? chosen : null
  })
}

/** The system's open dialog for one file of any kind; its path, or null. */
export function chooseFile(title: string): Promise<string | null> {
  return oneDialog(null, async () => {
    const chosen = await open({ multiple: false, title })
    return typeof chosen === 'string' ? chosen : null
  })
}

/**
 * Ontology terms for the SDRF editor: from the shim's on-disk cache, and only with `online` from OLS4 (then cached;
 * rejects offline without a cached answer).
 */
export function olsSearch(query: string, ontologies: string[], online: boolean): Promise<{ label: string; accession: string }[]> {
  return invoke('ols_search', { query, ontologies, online })
}

/** sdrf-pipelines' validator on an SDRF's text (`available` false when parse_sdrf is not installed). */
export function validateSdrf(text: string, template: string | null): Promise<{ available: boolean; ok: boolean; output: string }> {
  return invoke('validate_sdrf', { text, template })
}

/** The files of a ProteomeXchange project in PRIDE. */
export function prideFiles(pxd: string): Promise<{ name: string; size: number; url: string }[]> {
  return invoke('pride_files', { pxd })
}

export type DownloadProgress = { file: number; files: number; name: string; received: number; size: number }

/** The system's folder dialog for a download; the shim keeps the folder (the page cannot name another). Null if cancelled. */
export function chooseDownloadFolder(title: string): Promise<string | null> {
  return oneDialog(null, () => invoke<string | null>('choose_download_folder', { title }))
}

/**
 * Downloads `files` into the folder of `chooseDownloadFolder` (resumed, checked against their sizes); `onProgress`
 * while it runs. -> the paths.
 */
export async function downloadDataFiles(files: { name: string; size: number; url: string }[], onProgress: (p: DownloadProgress) => void): Promise<string[]> {
  const unlisten = await listen<DownloadProgress>('download://progress', (e) => onProgress(e.payload))
  try {
    return await invoke<string[]>('download_data_files', { files })
  } finally {
    unlisten()
  }
}

export function cancelDownload(): Promise<void> {
  return invoke('cancel_download')
}

/**
 * Saves a project file (`contents`, its JSON): to the project opened or saved last unless `ask` (Save As, or no
 * project yet), else where the user chooses in the save dialog (suggesting `name`). The page's browser mode
 * downloads it. -> `{ path, name }` of the file written, or null if cancelled.
 */
export function saveProjectSetup(name: string, contents: string, ask: boolean): Promise<{ path: string; name: string } | null> {
  if (!isDesktop()) {
    const saved = browserDownload(name, new Blob([contents], { type: 'application/json' }))
    return Promise.resolve({ path: saved, name: saved })
  }
  return oneDialog(null, () => invoke<{ path: string; name: string } | null>('save_project_setup', { name, contents, ask }))
}

/**
 * Writes the project's SDRF (one made with "Create SDRF…", which has no file yet) beside the current project file as
 * `<name>.sdrf.tsv`; a file already there only if `overwrite`. -> `{ path, exists }` (`exists`: nothing written,
 * the page asks first); null in the page's browser mode, which has no folder to write into.
 */
export function saveProjectSdrf(contents: string, overwrite: boolean): Promise<{ path: string; exists: boolean } | null> {
  if (!isDesktop()) return Promise.resolve(null)
  return invoke<{ path: string; exists: boolean }>('save_project_sdrf', { contents, overwrite })
}

/**
 * Opens a project file: the open dialog, or with `recent` the n-th of File › Open Recent (the shim keeps the list:
 * the page never names a path). The page's browser mode asks with the browser's file picker. -> `{ path, text }`
 * (in the browser `path` is the file's name), or null if cancelled.
 */
export function openProjectSetup(recent?: number): Promise<{ path: string; text: string } | null> {
  if (!isDesktop()) return pickTextFile('.json,application/json')
  return oneDialog(null, () => invoke<{ path: string; text: string } | null>('open_project_setup', { recent: recent ?? null }))
}

/** The browser's file picker for one text file (the page's browser mode): its name and text, or null if cancelled. */
function pickTextFile(accept: string): Promise<{ path: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    input.dataset.testid = 'project-file-input'
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      input.remove()
      if (!file) return resolve(null)
      void file.text().then((text) => resolve({ path: file.name, text }), () => resolve(null))
    })
    input.addEventListener('cancel', () => {
      input.remove()
      resolve(null)
    })
    document.body.append(input)
    input.click()
  })
}

/** No current project (File › New Search): the next Save asks where, the window's title is the app's again. */
export function forgetProjectSetup(): Promise<void> {
  if (!isDesktop()) return Promise.resolve()
  return invoke<void>('forget_project_setup').catch(() => undefined)
}

/** A click on a menu item of the page's (`menu://action`, src-tauri/src/menu.rs): its id. Returns the way to stop listening. */
export async function onMenuAction(handler: (id: string) => void): Promise<() => void> {
  if (!isDesktop()) return () => {}
  return listen<string>('menu://action', (e) => handler(e.payload))
}

/** Which menu items apply: Export with an open result, its CSV and Excel with a table, the theme's check mark. */
export function setMenuState(state: { result: boolean; table: boolean; theme: string }): Promise<void> {
  if (!isDesktop()) return Promise.resolve()
  return invoke<void>('menu_state', { state }).catch(() => undefined)
}
