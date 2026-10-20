// The exports of the Export menu: the current view as CSV, the design, the merged idXML; each saved
// where the user chooses (the system's save dialog).

import { writeDesignTsv } from '../design/design-tsv'
import { saveSearchFile } from '../desktop'
import { download } from '../download'
import type { OpenResult } from '../search/session.svelte'
import { resultName } from './display'
import type { ResultsView } from './view.svelte'

/** The name of a result's exports (see `resultName`). */
export function exportName(result: OpenResult): string {
  return resultName(result.design.rows.map((r) => r.fileName))
}

/** After the browser has painted (so that "Exporting…" shows before a long export). */
const painted = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))

/**
 * The current level's view as `<name>-<level>.csv` (`view.exporting` meanwhile); false on a tab
 * without a table or while an export runs.
 */
export async function exportCsv(view: ResultsView): Promise<boolean> {
  const level = view.level
  if (!level || view.exporting) return false
  view.exporting = true
  try {
    await painted()
    await download(`${exportName(view.result)}-${level.level}.csv`, level.csv(), 'text/csv;charset=utf-8')
    return true
  } finally {
    view.exporting = false
  }
}

/** The design of the searched files as `<name>_design.tsv` (OpenMS' one-table format). */
export async function exportDesign(result: OpenResult): Promise<void> {
  await download(`${exportName(result)}_design.tsv`, writeDesignTsv(result.design), 'text/tab-separated-values')
}

/** ProSE writes the merged idXML (`-out_merged`) for searches of several files. */
export function idXMLAvailable(result: OpenResult): boolean {
  return result.design.rows.length > 1
}

/** The merged idXML of the search folder, saved as `<name>.idXML`. */
export async function exportIdXML(result: OpenResult): Promise<void> {
  await saveSearchFile(result.id, 'merged.idXML', `${exportName(result)}.idXML`)
}
