<script lang="ts">
  // The app's keyboard shortcuts (survey P0, F13) and their overlay ("?", or Help › Keyboard shortcuts).
  // ⌘/Ctrl+⇧+1–4 switch the views, ⌘/Ctrl+1–6 the tabs of Results, ⌘/Ctrl+F (or "/") goes to the table's filter.
  // The single-character keys ("/", "?") can be turned off (WCAG 2.1.4); they never act while typing in a field.
  // In the desktop app ⌘/Ctrl+⇧1–4 are the View menu's accelerators (src/lib/menu.svelte.ts): the menu owns them there,
  // and this handler only in the browser, so that a key is not handled twice.
  import * as Dialog from '$lib/components/ui/dialog'
  import { isDesktop } from '$lib/desktop'
  import { navigate, router } from '$lib/route.svelte'
  import { shortcuts } from '$lib/shortcuts.svelte'

  const mac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
  const mod = mac ? '⌘' : 'Ctrl'
  const views = ['search', 'results', 'history', 'help'] as const
  const desktop = isDesktop()

  const typing = (t: EventTarget | null) =>
    t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))

  function focusFilter(): boolean {
    const field = document.querySelector<HTMLInputElement>('[data-testid="filter-bar"] input[type="search"]')
    field?.focus()
    field?.select()
    return field !== null
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.defaultPrevented || e.isComposing) return
    const cmd = mac ? e.metaKey : e.ctrlKey
    const digit = /^Digit([1-9])$/.exec(e.code)?.[1]
    if (cmd && e.shiftKey && !e.altKey && digit && Number(digit) <= views.length) {
      if (desktop) return
      e.preventDefault()
      const view = views[Number(digit) - 1]
      navigate(view === 'results' ? { view, id: router.resultId } : { view })
    } else if (cmd && !e.shiftKey && !e.altKey && digit && router.route.view === 'results') {
      const tabs = document.querySelectorAll<HTMLElement>('[data-testid="results-tabs"] [role="tab"]')
      const tab = tabs[Number(digit) - 1]
      if (tab) {
        e.preventDefault()
        tab.click()
        tab.focus()
      }
    } else if (cmd && !e.shiftKey && e.key.toLowerCase() === 'f' && router.route.view === 'results') {
      if (focusFilter()) e.preventDefault()
    } else if (shortcuts.characterKeys && !cmd && !e.altKey && !typing(e.target)) {
      if (e.key === '?') {
        e.preventDefault()
        shortcuts.open = true
      } else if (e.key === '/' && router.route.view === 'results' && focusFilter()) {
        e.preventDefault()
      }
    }
  }

  const rows: [string, string][] = [
    [`${mod} ⇧ 1 … 4`, 'New search, Results, History, Help'],
    [`${mod} 1 … 6`, 'Results: Overview, Proteins, Peptides, PSMs, Samples, QC'],
    [`${mod} F  or  /`, 'Results: the filter of the table'],
    ['↑ ↓  Home  End', 'Tables: move through the rows'],
    ['Enter', 'Tables: open the row (protein, its PSMs, the spectrum)'],
    ['← →', 'Spectrum view: previous and next PSM'],
    ['Esc', 'Close the protein panel or the spectrum view'],
    ['Drag, double-click', 'Spectrum: zoom into an m/z range, zoom out'],
    [`${mod} Enter`, 'New search: start the search'],
    ...(desktop
      ? ([
          [`${mod} O`, 'Open a project (.prose-setup.json)'],
          [`${mod} S  ·  ${mod} ⇧ S`, 'Save the project · Save it as'],
          [`${mod} N`, 'New search'],
          [`${mod} /`, 'This list'],
        ] as [string, string][])
      : []),
    ['?', 'This list'],
  ]
</script>

<svelte:window {onkeydown} />

<Dialog.Root bind:open={shortcuts.open}>
  <Dialog.Content class="gap-3 sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Keyboard shortcuts</Dialog.Title>
    </Dialog.Header>
    <table class="text-[13px]">
      <tbody>
        {#each rows as [keys, what] (keys)}
          <tr class="border-b last:border-0">
            <td class="py-1.5 pr-4 whitespace-nowrap"><kbd class="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{keys}</kbd></td>
            <td class="py-1.5 text-muted-foreground">{what}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    <label class="flex items-center gap-2 text-xs">
      <input type="checkbox" bind:checked={shortcuts.characterKeys} />
      Single-key shortcuts (“?” and “/”) on
    </label>
  </Dialog.Content>
</Dialog.Root>
