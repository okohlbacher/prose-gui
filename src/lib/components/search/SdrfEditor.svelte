<script lang="ts">
  // "Edit metadata…" of the SDRF panel: every column of the SDRF, one row per SDRF row. A cell offers the reserved
  // values and the column's bundled terms; in a column with an ontology, Enter looks the term up in OLS, and typing
  // offers the terms looked up before (the shim's cache; nothing leaves the computer while typing). Rows can be
  // selected and a value applied to them; templates of sdrf-pipelines add their required and recommended columns;
  // parse_sdrf validates when it is installed.
  import { Button } from '$lib/components/ui/button'
  import * as Dialog from '$lib/components/ui/dialog'
  import { sdrfSession as sdrf } from '$lib/design/sdrf-session.svelte'
  import { cell, dataRows, setCell, writeSdrfTable } from '$lib/design/sdrf-table'
  import { addTemplateColumns, choices, columnKind, fillRows, TEMPLATES, termValue } from '$lib/design/sdrf-terms'
  import { errorText, isDesktop, olsSearch, validateSdrf } from '$lib/desktop'

  let { open = $bindable(false) }: { open?: boolean } = $props()

  const t = $derived(sdrf.table)
  const rows = $derived(t ? dataRows(t) : [])
  const kinds = $derived(t ? t.headers.map(columnKind) : [])
  /** Cell issues by "row\0col". */
  const issueAt = $derived(new Map(sdrf.issues.filter((i) => i.row >= 0 && i.col >= 0).map((i) => [`${i.row}\0${i.col}`, i])))

  let selected = $state<Record<number, boolean>>({})
  let suggestions = $state<Record<number, string[]>>({})
  let lookup = $state<string | null>(null)
  let template = $state('ms-proteomics')
  let added = $state<string | null>(null)
  let validation = $state<{ available: boolean; ok: boolean; output: string } | null>(null)
  let validating = $state(false)

  const chosenRows = () => {
    const picked = rows.filter((r) => selected[r])
    return picked.length > 0 ? picked : rows
  }

  /**
   * Terms of the column's ontologies for `text`: while typing (`online` false) only those looked up before (the
   * shim's cache, no request leaves the computer); on Enter (`online`) from OLS.
   */
  let timer: ReturnType<typeof setTimeout> | undefined
  function search(col: number, text: string, online: boolean) {
    const kind = kinds[col]
    clearTimeout(timer)
    if (!isDesktop() || kind.ontologies.length === 0 || text.trim().length < 3 || text.startsWith('NT=')) return
    const ask = async () => {
      try {
        if (online) lookup = `Looking “${text.trim()}” up in OLS…`
        const terms = await olsSearch(text, kind.ontologies, online)
        suggestions[col] = terms.map((term) => termValue(kind, term))
        lookup = online && terms.length === 0 ? `OLS has no term for “${text.trim()}”.` : null
      } catch (e) {
        lookup = errorText(e)
      }
    }
    if (online) void ask()
    else timer = setTimeout(ask, 150)
  }

  function set(row: number, col: number, value: string) {
    sdrf.update((table) => setCell(table, row, col, value.trim()))
  }

  /** "Apply ↓": the value of the first chosen row to all chosen rows (all rows without a selection). */
  function fill(col: number) {
    const target = chosenRows()
    if (!t || target.length === 0) return
    const value = cell(t, target[0], col)
    sdrf.update((table) => fillRows(table, target, col, value))
  }

  function addTemplate() {
    let names: string[] = []
    sdrf.update((table) => (names = addTemplateColumns(table, [template])))
    added = names.length === 0 ? `The SDRF has all columns of ${template}.` : `Added: ${names.join(', ')}.`
  }

  async function validate() {
    if (!t) return
    validating = true
    try {
      validation = await validateSdrf(sdrf.text(), template)
    } catch (e) {
      validation = { available: true, ok: false, output: errorText(e) }
    } finally {
      validating = false
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex h-[88vh] flex-col gap-3 sm:max-w-[95vw]">
    <Dialog.Header>
      <Dialog.Title>Metadata of {sdrf.name}</Dialog.Title>
      <Dialog.Description>
        Every column of the SDRF. Choose a value from a cell's list or type it; in a column with an ontology, Enter looks the term up in OLS
        (online); while you type, only terms looked up before are offered. Select rows to apply a value to them with ↓ in the column's header (without a selection: all rows).
      </Dialog.Description>
    </Dialog.Header>
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <label for="sdrf-template" class="text-muted-foreground">Template</label>
      <select id="sdrf-template" class="h-7 rounded-md border bg-background px-2" bind:value={template}>
        {#each TEMPLATES as tpl (tpl.name)}<option value={tpl.name} title={tpl.description}>{tpl.name} {tpl.version}</option>{/each}
      </select>
      <Button variant="outline" size="sm" class="h-7 px-2 text-xs" onclick={addTemplate}>Add its columns</Button>
      <Button variant="outline" size="sm" class="h-7 px-2 text-xs" disabled={validating || !isDesktop()} onclick={validate}
        >{validating ? 'Validating…' : 'Validate with sdrf-pipelines'}</Button>
      <span class="text-muted-foreground">{sdrf.issues.length} built-in {sdrf.issues.length === 1 ? 'issue' : 'issues'}</span>
      {#if added}<span class="text-muted-foreground">{added}</span>{/if}
      {#if lookup}<span class="text-amber-700 dark:text-amber-400">{lookup}</span>{/if}
    </div>
    {#if validation}
      {#if !validation.available}
        <p class="text-xs text-muted-foreground" data-testid="validator-hint">
          sdrf-pipelines is not installed. Install it with <code class="rounded bg-muted px-1">pip install sdrf-pipelines</code>
          (then restart ProSE), or use the online validator at https://www.ebi.ac.uk/pride/services/sdrf-validator.
        </p>
      {:else}
        <pre class="max-h-40 overflow-auto rounded-md border p-2 text-[11px] whitespace-pre-wrap {validation.ok ? '' : 'text-destructive'}"
          data-testid="validator-output">{validation.output || (validation.ok ? 'No errors.' : 'Failed.')}</pre>
      {/if}
    {/if}
    {#if t}
      <div class="min-h-0 flex-1 overflow-auto rounded-md border" data-testid="sdrf-editor">
        <table class="border-collapse text-xs">
          <thead class="sticky top-0 z-10 bg-card">
            <tr>
              <th class="border-b px-1.5 py-1"><span class="sr-only">Select</span></th>
              {#each t.headers as h, c (c)}
                <th class="border-b px-1.5 py-1 text-left font-medium whitespace-nowrap {sdrf.toFill.includes(h) ? 'text-amber-700 dark:text-amber-400' : ''}">
                  {h}
                  <button class="ml-1 text-muted-foreground hover:text-foreground" title="Apply the value of the first selected row to the selected rows (all rows without a selection)" onclick={() => fill(c)}>↓</button>
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each rows as r (r)}
              <tr>
                <td class="border-b px-1.5"><input type="checkbox" aria-label="Select row {r + 2}" bind:checked={selected[r]} /></td>
                {#each t.headers as h, c (c)}
                  {@const issue = issueAt.get(`${r}\0${c}`)}
                  <td class="border-b px-0.5 py-0.5">
                    <input
                      class="h-6 w-44 rounded border bg-background px-1 {issue ? (issue.level === 'error' ? 'border-destructive' : 'border-amber-500') : 'border-transparent'}"
                      aria-label="{h} of row {r + 2}"
                      title={issue?.message ?? cell(t, r, c)}
                      list="sdrf-list-{c}"
                      value={cell(t, r, c)}
                      oninput={(e) => search(c, e.currentTarget.value, false)}
                      onkeydown={(e) => e.key === 'Enter' && search(c, e.currentTarget.value, true)}
                      onchange={(e) => set(r, c, e.currentTarget.value)} />
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
        {#each kinds as kind, c (c)}
          <datalist id="sdrf-list-{c}">
            {#each [...new Set([...choices(kind), ...(suggestions[c] ?? [])])] as v (v)}<option value={v}></option>{/each}
          </datalist>
        {/each}
      </div>
    {/if}
    <Dialog.Footer>
      <span class="mr-auto text-xs text-muted-foreground">{t ? `${rows.length} rows · ${t.headers.length} columns · ${writeSdrfTable(t).length.toLocaleString('en-US')} bytes` : ''}</span>
      <Button onclick={() => (open = false)}>Done</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
