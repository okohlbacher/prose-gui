// The state of History for the views: the saved searches, what became of the last save, and the actions
// of the views (open from History, save and open a project file, rename, delete). A finished search is
// saved here automatically, right after the shim's `done`; saving never breaks the results view, it only
// reports. A search that finished while it was being cancelled has its folder removed at once.

import { desktopBackend, errorText } from '../desktop'
import { resultName } from '../results/display'
import { navigate } from '../route.svelte'
import {
  finishedWhileCancelled,
  forgetFinishedWhileCancelled,
  onFinishedWhileCancelled,
  onSearchFinished,
  openResult,
  openStoredResult,
  type OpenResult,
} from '../search/session.svelte'
import { toolState } from '../search/tool.svelte'
import { exportProject, importProject, openSearch, ProjectError, saveSearch, type HistoryBackend, type HistoryEntry } from './history'

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
function nameOf(result: OpenResult): string {
  const listed = entries.find((e) => e.id === result.id)?.name
  return listed ?? result.stored?.name ?? resultName(result.design.rows.map((r) => r.fileName))
}

let queue: Promise<unknown> = Promise.resolve()

/**
 * Saves a search that finished in this session to History. Saves go one after the other; this never
 * rejects: the outcome is `history.save`.
 */
export function saveFinished(result: OpenResult): Promise<void> {
  const run = queue.then(async () => {
    status = { id: result.id, state: 'saving' }
    try {
      await saveSearch(backend, result, nameOf(result), toolState.info?.version ?? 'unknown')
      status = { id: result.id, state: 'saved' }
    } catch (e) {
      status = { id: result.id, state: 'unsaved', message: describeSaveFailure(e) }
      return
    }
    await refreshHistory()
  })
  queue = run.catch(() => {})
  return run
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

/** Starts History: saves the searches that finish, removes the cancelled ones, reads the list. */
export function initHistory(): void {
  if (started) return
  started = true
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

/** Opens a saved search in Results; the one already open is just shown. */
export async function openFromHistory(id: string): Promise<void> {
  if (openResult.current?.id === id) {
    navigate({ view: 'results', id })
    return
  }
  await show(id)
}

/** Reopens the search of an address (`#/results/<id>`), e.g. after a restart; false if History does not have it. */
export async function restoreFromHistory(id: string): Promise<boolean> {
  if (openResult.current?.id === id) return true
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
 * Saves `result` as a project file where the user chooses (the save dialog). A search that is not in
 * History yet (its save failed) is saved first. Resolves with the path, or null if the user cancelled.
 */
export async function saveProjectFile(result: OpenResult): Promise<string | null> {
  const saved = () => entries.some((e) => e.id === result.id && e.error === null)
  if (!saved()) await refreshHistory()
  if (!saved()) {
    await saveFinished(result)
    if (status?.state === 'unsaved' && status.id === result.id) throw new ProjectError(status.message)
  }
  return exportProject(backend, result.id, nameOf(result))
}

export async function removeFromHistory(id: string): Promise<void> {
  await backend.delete(id)
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
