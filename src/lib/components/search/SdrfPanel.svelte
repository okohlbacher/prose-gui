<script lang="ts">
  // The loaded SDRF in the Spectra card: how many of its data files were found, "Locate folder…", "Save SDRF…",
  // what its rules check reports, and the data files that are not found, each with "Locate…".
  import CircleXIcon from '@lucide/svelte/icons/circle-x'
  import CloudDownloadIcon from '@lucide/svelte/icons/cloud-download'
  import FileCogIcon from '@lucide/svelte/icons/file-cog'
  import XIcon from '@lucide/svelte/icons/x'
  import { Button } from '$lib/components/ui/button'
  import { sdrfSession as sdrf, STATUS_TEXT } from '$lib/design/sdrf-session.svelte'
  import { convertCommand } from '$lib/design/sdrf-download'
  import { download } from '$lib/download'
  import { formatBytes } from '$lib/format/bytes'
  import SdrfEditor from './SdrfEditor.svelte'

  let saveError = $state<string | null>(null)
  let editing = $state(false)
  const found = $derived(sdrf.files.length - sdrf.unresolved.length)
  const errors = $derived(sdrf.issues.filter((i) => i.level === 'error'))
  const warnings = $derived(sdrf.issues.filter((i) => i.level === 'warning'))
  const where = (row: number) => (row < 0 ? 'header' : `row ${row + 2}`)

  async function save() {
    saveError = null
    try {
      await download(sdrf.name || 'sdrf.tsv', sdrf.text(), 'text/tab-separated-values')
    } catch (e) {
      saveError = String((e as Error)?.message ?? e)
    }
  }
</script>

{#if sdrf.path}
  <div class="flex flex-col gap-1.5 rounded-md border bg-muted/30 px-3 py-2 text-xs" data-testid="sdrf-panel">
    <div class="flex flex-wrap items-center gap-2">
      <span class="font-medium" title={sdrf.path}>SDRF {sdrf.name}</span>
      <span class="text-muted-foreground">
        {sdrf.busy ? 'looking for its data files…' : `${found} of ${sdrf.files.length} data files found`}{sdrf.folder ? ` (also below ${sdrf.folder})` : ''}
      </span>
      <div class="flex-1"></div>
      <Button variant="outline" size="sm" class="h-6 px-2 text-xs" disabled={sdrf.busy} onclick={() => sdrf.locateFolder()}>Locate folder…</Button>
      <Button variant="outline" size="sm" class="h-6 px-2 text-xs" onclick={() => (editing = true)}>Edit metadata…</Button>
      <Button variant="outline" size="sm" class="h-6 px-2 text-xs" onclick={save}>Save SDRF…</Button>
      <Button variant="ghost" size="icon-xs" class="text-muted-foreground" aria-label="Forget the SDRF" title="Forget the SDRF (its files stay)" onclick={() => sdrf.clear()}><XIcon /></Button>
    </div>
    {#if sdrf.stillToFill.length > 0}
      <p class="text-amber-700 dark:text-amber-400" data-testid="sdrf-to-fill">
        To fill in before sharing (Edit metadata…): {sdrf.stillToFill.join(', ')} (now “not available”).
      </p>
    {/if}
    {#if errors.length + warnings.length > 0}
      <details>
        <summary class="cursor-pointer text-muted-foreground">
          SDRF check: {errors.length} {errors.length === 1 ? 'error' : 'errors'}, {warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}
        </summary>
        <ul class="mt-1 flex flex-col gap-0.5">
          {#each sdrf.issues as issue, k (k)}
            <li class={issue.level === 'error' ? 'text-destructive' : 'text-amber-700 dark:text-amber-400'}>
              {where(issue.row)}{issue.col >= 0 ? `, ${sdrf.table?.headers[issue.col]}` : ''}: {issue.message}
            </li>
          {/each}
        </ul>
      </details>
    {/if}
    {#if sdrf.unresolved.length > 0}
      <ul class="flex flex-col gap-1" data-testid="sdrf-unresolved">
        {#each sdrf.unresolved as file (file.name)}
          <li class="flex items-center gap-2">
            {#if file.status === 'remote'}<CloudDownloadIcon class="size-3.5 text-muted-foreground" />
            {:else if file.status === 'vendor'}<FileCogIcon class="size-3.5 text-amber-600" />
            {:else}<CircleXIcon class="size-3.5 text-destructive" />{/if}
            <span class="font-mono">{file.name}</span>
            <span class="text-muted-foreground" title={file.uri || file.path || ''}>{STATUS_TEXT[file.status]}</span>
            <Button variant="ghost" size="sm" class="h-5 px-1.5 text-xs" onclick={() => sdrf.locateFile(file.name)}>Locate…</Button>
          </li>
        {/each}
      </ul>
      {#each sdrf.unresolved.filter((f) => f.status === 'vendor' && f.path) as file (file.name)}
        {@const command = convertCommand(file.path!)}
        <p class="flex flex-wrap items-center gap-2 text-muted-foreground" data-testid="sdrf-convert">
          ProSE cannot read {file.name}. Convert it to mzML, then Locate folder…:
          <code class="rounded bg-muted px-1 font-mono">{command}</code>
          <Button variant="ghost" size="sm" class="h-5 px-1.5 text-xs" onclick={() => navigator.clipboard?.writeText(command)}>Copy</Button>
        </p>
      {/each}
      {#if sdrf.unresolved.some((f) => f.status !== 'vendor')}
        <div class="flex flex-wrap items-center gap-2" data-testid="sdrf-download">
          <label for="sdrf-pxd" class="text-muted-foreground">PRIDE project</label>
          <input id="sdrf-pxd" class="h-6 w-28 rounded border bg-background px-1.5 font-mono" placeholder="PXD…" bind:value={sdrf.pxd} />
          {#if sdrf.download}
            {@const d = sdrf.download}
            <span>Downloading {d.name} ({d.file + 1} of {d.files}): {formatBytes(d.received)}{d.size ? ` of ${formatBytes(d.size)}` : ''}</span>
            <Button variant="ghost" size="sm" class="h-6 px-2 text-xs" onclick={() => sdrf.cancelDownload()}>Cancel</Button>
          {:else}
            <Button variant="outline" size="sm" class="h-6 px-2 text-xs" onclick={() => sdrf.downloadMissing()}>Download missing…</Button>
          {/if}
        </div>
      {/if}
      {#if sdrf.downloadError}<p class="text-destructive">{sdrf.downloadError}</p>{/if}
      <label class="flex items-center gap-1.5 text-muted-foreground">
        <input type="checkbox" bind:checked={sdrf.skipMissing} /> Search without them
      </label>
    {/if}
    {#if saveError}<p class="text-destructive">{saveError}</p>{/if}
  </div>
{/if}
<SdrfEditor bind:open={editing} />
