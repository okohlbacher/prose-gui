// The state of History for the views: the saved searches, what became of the last save, and the actions
// of the views (open from History, save and open a project file, rename, delete). A search is saved here
// automatically: its record as soon as ProSE has ended (before its results are read, so that a search
// whose results cannot be read stays in History and can be opened again), its proteins.fasta once its
// results are read. Saving never breaks the results view, it only reports. A search that finished while it
// was being cancelled has its folder removed at once.

import { desktopBackend, errorText, importQpxFolder, openQpxFolder } from '../desktop'
import { resolveDesign } from '../design/model'
import { baseName } from '../results/model'
import { parameterNumber, qpxParameters, readMeta, targetPsmsOf } from '../results/summary'
import { resultName } from '../results/display'
import { forgetResult, navigate, router } from '../route.svelte'
import {
  closeResult,
  finishedWhileCancelled,
  forgetFinishedWhileCancelled,
  onFinishedWhileCancelled,
  onSearchEnded,
  onSearchFinished,
  openFinished,
  openResult,
  openStoredResult,
  type EndedSearch,
  type OpenResult,
} from '../search/session.svelte'
import { sdrfSession } from '../design/sdrf-session.svelte'
import { searchForm } from '../search/form.svelte'
import { canSearchAgain, parametersToSearchAgain, searchAgain, searchPlan, startSearch } from '../search/plan.svelte'
import { acceptedKeys } from '../search/checks'
import { toolState } from '../search/tool.svelte'
import {
  APP_VERSION,
  SCHEMA_VERSION,
  endedRecordOf,
  exportProject,
  importProject,
  openSearch,
  parseRecord,
  ProjectError,
  RECORD_FILE,
  proteinsFasta,
  psmsOfSearch,
  recordOf,
  type HistoryBackend,
  type HistoryEntry,
} from './history'

/** What became of the save of a finished search. */
export type SaveStatus =
  | { id: string; state: 'saving' }
  | { id: string; state: 'saved' }
  | { id: string; state: 'unsaved'; message: string }

let backend: HistoryBackend = desktopBackend

/** Uses another disk (the tests'). */
export function useBackend(next: HistoryBackend): void {
  backend = next
}

let entries = $state.raw<HistoryEntry[]>([])
let ready = $state(false)
let problem = $state<string | null>(null)
let status = $state<SaveStatus | null>(null)

export const history = {
  /** The saved searches, the latest first (a folder that cannot be opened has `error`). */
  get entries(): HistoryEntry[] {
    return entries
  },
  /** The list has been read. */
  get ready(): boolean {
    return ready
  },
  /** Why the list could not be read, or null. */
  get unavailable(): string | null {
    return problem
  },
  /** The last save of a finished search. */
  get save(): SaveStatus | null {
    return status
  },
}

const KEEP_AS_FILE = 'The results stay open here, but the search is not in History.'

/** What to tell the user about a save that did not happen. */
export function describeSaveFailure(error: unknown): string {
  return `Not saved to History (${errorText(error)}). ${KEEP_AS_FILE}`
}

/** The latest refresh: an older one that finishes later must not overwrite its list. */
let refreshes = 0

/** Reads the list of saved searches. */
export async function refreshHistory(): Promise<void> {
  const refresh = ++refreshes
  try {
    const listed = await backend.list()
    if (refresh !== refreshes) return
    entries = listed
    problem = null
  } catch (e) {
    if (refresh !== refreshes) return
    entries = []
    problem = `History could not be read (${errorText(e)}).`
  } finally {
    ready = true
  }
}

/**
 * The name of a result in History and in its project file: the one History has (it may have been
 * renamed since it was opened), else the one it was stored with, else the exports' (from its files).
 */
function nameOf(result: Pick<OpenResult, 'id' | 'design' | 'stored'>): string {
  const listed = entries.find((e) => e.id === result.id)?.name
  return listed ?? result.stored?.name ?? resultName(result.design.rows.map((r) => r.fileName))
}

const toolVersion = () => toolState.info?.version ?? 'unknown'

/** Whether History lists the search as saved (with a record it can open). */
const isListed = (id: string) => entries.some((e) => e.id === id && e.error === null)

/** The records of this session's searches whose save failed: written again by `retrySave` and `openAgain`. */
const unsavedRecords = new Map<string, string>()

let queue: Promise<unknown> = Promise.resolve()

/** Runs `work` after the saves before it (saves go one after the other). */
function queued(work: () => Promise<void>): Promise<void> {
  const run = queue.then(work)
  queue = run.catch(() => {})
  return run
}

/** Writes a record; the outcome is `history.save` (true: saved). */
async function writeRecord(id: string, record: string): Promise<boolean> {
  status = { id, state: 'saving' }
  try {
    await backend.saveRecord(id, record)
  } catch (e) {
    unsavedRecords.set(id, record)
    status = { id, state: 'unsaved', message: describeSaveFailure(e) }
    return false
  }
  unsavedRecords.delete(id)
  status = { id, state: 'saved' }
  return true
}

/**
 * Saves the record of a search whose ProSE has just ended, before its results are read: from the request
 * and the target PSMs of its QPX run view (0 if that cannot be read). Never rejects: the outcome is
 * `history.save`.
 */
export function saveEnded(search: EndedSearch): Promise<void> {
  return queued(async () => {
    let psms = 0
    try {
      psms = await psmsOfSearch(backend, search.id)
    } catch {
      // (the record is written all the same; the reader reports a summary that cannot be read)
    }
    const record = endedRecordOf(search, nameOf({ ...search, stored: undefined }), toolVersion(), psms)
    await writeRecord(search.id, JSON.stringify(record))
    await refreshHistory()
  })
}

/**
 * Completes the save of a search whose results have been read in this session: its record, if it has none
 * yet (the save when ProSE ended failed, or a result opened otherwise), then its proteins.fasta, which
 * replaces the folder's database.fasta. Saves go one after the other; this never rejects: the outcome is
 * `history.save` (a failure of proteins.fasta alone is not reported: the search is saved, opens with its
 * database, and its next opening writes proteins.fasta).
 */
export function saveFinished(result: OpenResult): Promise<void> {
  return queued(async () => {
    if (!isListed(result.id)) await refreshHistory()
    if (!isListed(result.id) && !(await writeRecord(result.id, JSON.stringify(recordOf(result, nameOf(result), toolVersion()))))) return
    await backend.saveProteins(result.id, proteinsFasta(result.outcome.tables)).catch(() => {})
    await refreshHistory()
  })
}

/** Whether the save of search `id` failed in this session and can be tried again (`retrySave`). */
export function canRetrySave(id: string): boolean {
  return unsavedRecords.has(id)
}

/**
 * Tries the failed save of search `id` again: its record, and, when its result is open, its
 * proteins.fasta. The outcome is `history.save`.
 */
export function retrySave(id: string): Promise<void> {
  const open = openResult.current
  if (open?.id === id) return saveFinished(open)
  const record = unsavedRecords.get(id)
  if (record === undefined) return Promise.resolve()
  return queued(async () => {
    await writeRecord(id, record)
    await refreshHistory()
  })
}

/**
 * Opens search `id` again after its results could not be read: its record is saved first if that had
 * failed, then the results are read again and shown (Results). Throws what is wrong, as `openFromHistory`.
 */
export async function openAgain(id: string): Promise<void> {
  if (unsavedRecords.has(id)) {
    await retrySave(id)
    if (unsavedRecords.has(id)) throw new ProjectError((status?.state === 'unsaved' && status.message) || 'The search is not saved to History.')
  }
  await openFromHistory(id)
}

/** Removes the folders of the searches that finished while they were cancelled. */
export async function removeCancelled(): Promise<void> {
  for (const id of [...finishedWhileCancelled()]) {
    try {
      await backend.delete(id)
      forgetFinishedWhileCancelled(id)
    } catch {
      // (it stays in the list; the sweep at the next start removes it after a while)
    }
  }
}

let started = false

/** Starts History: saves the searches that end and finish, removes the cancelled ones, reads the list. */
export function initHistory(): void {
  if (started) return
  started = true
  onSearchEnded((search) => saveEnded(search))
  onSearchFinished((result) => void saveFinished(result))
  onFinishedWhileCancelled(() => void removeCancelled())
  void removeCancelled()
  void refreshHistory()
}

/** Shows a saved search in Results and returns its id. Throws a ProjectError that says what is wrong. */
async function show(id: string): Promise<void> {
  const { result, origin } = await openSearch(backend, id)
  openStoredResult(result, origin)
  navigate({ view: 'results', id })
}

/**
 * Opens a saved search in Results; the one already open is just shown, one of this session that finished
 * while the user was elsewhere comes from memory (`openFinished`).
 */
export async function openFromHistory(id: string): Promise<void> {
  if (openResult.current?.id === id || openFinished(id)) {
    navigate({ view: 'results', id })
    return
  }
  await show(id)
}

/** Reopens the search of an address (`#/results/<id>`), e.g. after a restart; false if History does not have it. */
export async function restoreFromHistory(id: string): Promise<boolean> {
  if (openResult.current?.id === id || openFinished(id)) return true
  if (!ready) await refreshHistory()
  if (!entries.some((e) => e.id === id)) return false
  const { result, origin } = await openSearch(backend, id)
  openStoredResult(result, origin)
  return true
}

/**
 * Asks for a project file (the open dialog), makes a saved search of it and opens it in Results.
 * Resolves with false if the user cancelled. Throws a ProjectError (a ProjectVersionError for a newer
 * file) that says what is wrong.
 */
export async function openProjectFile(): Promise<boolean> {
  let id: string | null
  try {
    id = await importProject(backend)
  } catch (e) {
    if (e instanceof ProjectError) throw e
    throw new ProjectError(errorText(e))
  }
  if (id === null) return false
  await refreshHistory()
  await show(id)
  return true
}

/**
 * The search `id` of History in New search: its files (by their paths in inputs.json), their design, the database
 * (its path in database.json, else none: it was copied with the contaminants) and the settings; then, with `start`,
 * the search starts once the form can (Re-run). Resolves with whether it started.
 */
export async function reopenInNewSearch(id: string, start: boolean, changes: Record<string, unknown> = {}): Promise<boolean> {
  const record = parseRecord(new TextDecoder().decode(await backend.read(id, RECORD_FILE)))
  const inputs = JSON.parse(new TextDecoder().decode(await backend.read(id, 'inputs.json'))) as { path: string; name: string; index: number }[]
  // the user's FASTA: database.json (searched as it is), database-source.json (searched with contaminants)
  let database: string | null = null
  for (const name of ['database.json', 'database-source.json']) {
    try {
      database = (JSON.parse(new TextDecoder().decode(await backend.read(id, name))) as { path?: string }).path ?? null
      if (database) break
    } catch {
      // (not there: an older search, or one from a project)
    }
  }
  // the design rows are in input order (two files of one name in different folders stay apart)
  const ordered = [...inputs].sort((a, b) => a.index - b.index)
  navigate({ view: 'search' })
  // the SDRF of another experiment must not travel with this search; this one's is loaded again by hand
  sdrfSession.clear()
  const complete = await searchForm.restoreSearch({
    name: record.name,
    inputs: ordered.map((i, k) => {
      const r = record.design.rows[k]?.fileName === i.name ? record.design.rows[k] : record.design.rows.find((x) => x.fileName === i.name)
      return { path: i.path, fields: r ? { condition: r.condition ?? undefined, replicate: r.replicate, fraction: r.fraction, techReplicate: r.techReplicate } : {} }
    }),
    database,
    databaseName: record.database,
    settings: { ...record.settings, parameters: { ...parametersToSearchAgain(record.settings.parameters, record.psmFdr), ...changes } },
  })
  // the red flags searched anyway then are not asked again (they are recorded per file: `checks.ts`)
  if (record.accepted) searchPlan.accepted = new Set([...searchPlan.accepted, ...acceptedKeys(record.accepted)])
  if (record.sdrf) searchForm.notices.push(`“${record.name}” was searched with the SDRF ${record.sdrf.name}. Add it again (Add files…) to search with its metadata.`)
  if (!start) return false
  // Re-run starts only the same search: every file and the database found, no SDRF to load again
  if (!complete || record.sdrf) {
    searchForm.notices.push('Re-run did not start: check the files and the database above, then start the search.')
    return false
  }
  // (the database's proteins are counted in the background: start once the form allows it)
  for (let tries = 0; tries < 100 && !searchPlan.canStart; tries++) await new Promise((r) => setTimeout(r, 100))
  if (!searchPlan.canStart) {
    searchForm.notices.push('Re-run did not start: the form is not ready; see above.')
    return false
  }
  await startSearch()
  return true
}

/**
 * A guidance re-run (tolerance feedback, the diagnosis card): New search with the inputs and settings of `result`,
 * changed by `changes`, the changed values marked there (`SearchForm.guided`). The inputs stay if New search still
 * holds them; else the search is opened there from History. The user starts it.
 */
export async function rerunWith(result: OpenResult, changes: Record<string, unknown>): Promise<void> {
  if (canSearchAgain(result)) searchAgain(result, changes)
  else await reopenInNewSearch(result.id, false, changes)
  searchForm.markGuided(nameOf(result), result.settings.parameters, changes)
}

/**
 * "Open QPX folder…": the QPX output of a ProSE run outside the app (`-out_qpx <dir> -qpx_extended -keep_decoys`,
 * e.g. on a cluster) as a search in History, then opened in Results (survey F36). The record is made from the
 * run and provenance views: the inputs by their stems, the cutoffs and database as ProSE recorded them.
 * Resolves with false if the user cancelled.
 */
export async function openQpxFolderFile(): Promise<boolean> {
  let id: string
  try {
    const chosen = await openQpxFolder()
    if (chosen === null) return false
    const meta = await readMeta(chosen.run, chosen.provenance)
    // the inputs in ProSE's order (its run view), which the merged PSMs follow; the file names only where it has none
    const runOrder = meta.runs.map((r) => r.run_accession)
    const stems = runOrder.every((s) => chosen.stems.includes(s)) && runOrder.length === chosen.stems.length ? runOrder : chosen.stems
    const names = stems.map((s) => `${s.replace(/^\d+__/, '')}`)
    const inputs = stems.map((stem, index) => ({ id: `f${index + 1}`, index, link: stem, stem, name: names[index], path: names[index] }))
    const database = baseName(meta.search.get('database_file') ?? 'database')
    const record = {
      schema: SCHEMA_VERSION,
      id: 'qpx',
      name: baseName(chosen.folder),
      createdAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      toolVersion: '',
      files: names,
      database,
      design: resolveDesign(names.map((fileName, k) => ({ id: `f${k + 1}`, fileName, fileSize: 0 }))),
      settings: {
        parameters: qpxParameters(meta.search),
        fixedMods: (meta.search.get('fixed_modifications') ?? '').split(/[,;]\s*/).filter(Boolean),
        rescore: meta.runs.some((r) => r.rescoring_applied === true),
        peptdeep: meta.runs.some((r) => r.prediction_nce !== null),
        contaminants: false,
      },
      psms: targetPsmsOf(meta.runs),
      psmFdr: parameterNumber(meta.fdr, 'psm_fdr'),
      proteinFdr: parameterNumber(meta.fdr, 'protein_fdr'),
      seconds: parameterNumber(meta.search, 'seconds_total'),
    }
    id = await importQpxFolder(chosen.folder, JSON.stringify(record), JSON.stringify(inputs))
  } catch (e) {
    if (e instanceof ProjectError) throw e
    throw new ProjectError(errorText(e))
  }
  await refreshHistory()
  await show(id)
  return true
}

/**
 * Saves `result` as a project file where the user chooses (the save dialog), `onProgress` told how far the
 * writing is (0–1). A search that is not in History yet (its save failed) is saved first. Resolves with the
 * path, or null if the user cancelled.
 */
export async function saveProjectFile(result: OpenResult, onProgress?: (fraction: number) => void): Promise<string | null> {
  if (!isListed(result.id)) await refreshHistory()
  if (!isListed(result.id)) {
    await saveFinished(result)
    if (status?.state === 'unsaved' && status.id === result.id) throw new ProjectError(status.message)
  }
  return exportProject(backend, result.id, nameOf(result), onProgress)
}

/**
 * Deletes search `id` from History. If it is the open result, it is closed (its spectra, read as PSMs are
 * opened, are gone), the "Results" link no longer leads to it, and Results of it goes to History.
 */
export async function removeFromHistory(id: string): Promise<void> {
  await backend.delete(id)
  closeResult(id)
  forgetResult(id)
  if (router.route.view === 'results' && router.route.id === id) navigate({ view: 'history' })
  await refreshHistory()
}

/** Renames a saved search; an open result of it takes the name (Export › Project writes it, see `nameOf`). */
export async function rename(id: string, name: string): Promise<void> {
  const trimmed = name.trim()
  if (trimmed === '') return
  await backend.rename(id, trimmed)
  await refreshHistory()
}

/** Forgets the notice about the last save. */
export function dismissSaveStatus(): void {
  status = null
}

/**
 * The ProSE command line of search `id` (its `command.txt`, written by the shim; guidance G8), the parameters in
 * its `prose.ini`. The paths are placeholders (`<input 1>`, `<database>`, `<search folder>`); `withPaths` puts in
 * the inputs' paths (inputs.json: names only for a project) and the user's database. Null for a search made
 * before the app wrote it.
 */
export async function commandLineOf(id: string, withPaths: boolean): Promise<string | null> {
  const text = async (name: string) => new TextDecoder().decode(await backend.read(id, name))
  let line: string
  try {
    line = (await text('command.txt')).trim()
  } catch {
    return null
  }
  if (!withPaths) return line
  const quote = (p: string) => (/\s/.test(p) ? `"${p}"` : p)
  try {
    const inputs = JSON.parse(await text('inputs.json')) as { path: string; index: number }[]
    for (const i of inputs) line = line.replaceAll(`<input ${i.index + 1}>`, quote(i.path))
  } catch {
    // (no inputs.json: the placeholders stay)
  }
  for (const name of ['database.json', 'database-source.json']) {
    try {
      const path = (JSON.parse(await text(name)) as { path?: string }).path
      if (path) {
        line = line.replaceAll('<database>', quote(path))
        break
      }
    } catch {
      // (not there)
    }
  }
  return line
}
