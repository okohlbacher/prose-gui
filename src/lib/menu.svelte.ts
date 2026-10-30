// The application menus of the desktop app (src-tauri/src/menu.rs): a click on one of the page's items comes as
// `menu://action` with its id and is done here with the functions the page's own buttons use (navigate, Help, the
// exports, History, projects). The menu is told which items apply (Export with an open result, CSV and Excel with
// a table, the theme's check mark). The menus' accelerators (⌘/Ctrl+N, O, S, ⇧S, W, ⇧1–4, /) belong to the menus:
// Shortcuts.svelte leaves ⌘/Ctrl+⇧1–4 to them in the desktop app and keeps them in the browser.

import { toast } from 'svelte-sonner'
import { isDesktop, onMenuAction, openUrl, setMenuState, errorText } from './desktop'
import { openHelp } from './help-link.svelte'
import { openProjectFile, openQpxFolderFile, saveProjectFile } from './history/history.svelte'
import { openProject, saveProject } from './project/project.svelte'
import { exportCsv, exportIdXML, exportXlsx } from './results/exports'
import { resultsViewFor } from './results/view.svelte'
import { navigate, router } from './route.svelte'
import { openResult } from './search/session.svelte'
import { shortcuts } from './shortcuts.svelte'
import { theme } from './theme/theme.svelte'
import type { ThemePreference } from './theme/theme'

export const WEB_APP_URL = 'https://timosachsenberg.github.io/prose-web/'
export const ISSUES_URL = 'https://github.com/timosachsenberg/prose-gui/issues'

/** The result open in Results, if Results shows one. */
function shownResult() {
  const route = router.route
  return route.view === 'results' && openResult.current !== null && openResult.current.id === route.id ? openResult.current : null
}

/** Runs `action`, and says in a message what went wrong (`what` names it). */
async function attempt(what: string, action: () => Promise<unknown>): Promise<void> {
  try {
    await action()
  } catch (e) {
    toast.error(`${what} failed`, { description: errorText(e) })
  }
}

/** Does what menu item `id` stands for (menu.rs lists the ids). */
export async function menuAction(id: string): Promise<void> {
  const result = shownResult()
  const view = result ? resultsViewFor(result) : null
  const recent = /^recent:(\d+)$/.exec(id)
  if (recent) return attempt('Open Project', () => openProject(Number(recent[1])))
  switch (id) {
    case 'new-search':
    case 'view-search':
      return navigate({ view: 'search' })
    case 'view-results':
      return navigate({ view: 'results', id: router.resultId })
    case 'view-history':
      return navigate({ view: 'history' })
    case 'view-help':
    case 'help':
      return navigate({ view: 'help' })
    case 'help-troubleshooting':
      return openHelp('troubleshooting')
    case 'help-shortcuts':
      shortcuts.open = true
      return
    case 'help-webapp':
      return attempt('Opening the link', () => openUrl(WEB_APP_URL))
    case 'help-issue':
      return attempt('Opening the link', () => openUrl(ISSUES_URL))
    case 'open-project':
      return attempt('Open Project', () => openProject())
    case 'save-project':
      return attempt('Save Project', () => saveProject(false))
    case 'save-project-as':
      return attempt('Save Project As', () => saveProject(true))
    case 'open-qpx':
      navigate({ view: 'history' })
      return attempt('Open QPX folder', () => openQpxFolderFile())
    case 'import-results':
      navigate({ view: 'history' })
      return attempt('Import results archive', () => openProjectFile())
    case 'export-csv':
      if (view) return attempt('CSV export', () => exportCsv(view))
      return
    case 'export-xlsx':
      if (view) return attempt('Excel export', () => exportXlsx(view))
      return
    case 'export-idxml':
      if (result) return attempt('idXML export', () => exportIdXML(result))
      return
    case 'export-archive':
      if (result)
        return attempt('Results archive', async () => {
          const path = await saveProjectFile(result)
          if (path) toast.success('Results archive saved', { description: path })
        })
      return
    case 'theme-system':
    case 'theme-light':
    case 'theme-dark':
      theme.preference = id.slice('theme-'.length) as ThemePreference
      // (a check item marks itself when clicked: the marks are set again, also for the theme already chosen)
      return pushMenuState()
  }
}

/** Tells the menus which items apply now. */
function pushMenuState(): Promise<void> {
  const result = shownResult()
  const level = result ? resultsViewFor(result).level : null
  return setMenuState({ result: result !== null, table: level !== null, theme: theme.preference })
}

let started = false

/** Listens to the menus and keeps their state (the desktop app only). */
export function initMenu(): void {
  if (started || !isDesktop()) return
  started = true
  void onMenuAction((id) => void menuAction(id))
  $effect.root(() => {
    $effect(() => void pushMenuState())
  })
}
