<script lang="ts">
  // The header's Export menu of the open result.
  import { buttonVariants } from '$lib/components/ui/button'
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu'
  import { saveProjectFile } from '$lib/history/history.svelte'
  import { exportCsv, exportDesign, exportIdXML, idXMLAvailable } from '$lib/results/exports'
  import type { ResultsView } from '$lib/results/view.svelte'
  import { cn } from '$lib/utils'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'

  let { view }: { view: ResultsView } = $props()

  // a disabled item keeps the pointer, so that its title says why
  const explained = 'data-disabled:pointer-events-auto data-disabled:cursor-not-allowed'

  let open = $state(false)
  let canIdXML = $state(false)
  let canSpectrum = $state(false)
  let busy = $state(false)
  let projecting = $state(false)
  let error = $state<string | null>(null)

  function openChange(next: boolean) {
    open = next
    if (next) {
      canIdXML = idXMLAvailable(view.result)
      canSpectrum = view.psm !== null && view.spectrumExporter !== null
    }
  }

  async function guard(action: () => unknown) {
    error = null
    try {
      await action()
    } catch (e) {
      error = String((e as Error)?.message ?? e)
    }
  }

  /** The search's folder as a project file (a zip; large for a large search), written where the user chooses. */
  async function project() {
    busy = true
    projecting = true
    error = null
    try {
      await saveProjectFile(view.result)
    } catch (e) {
      error = `Project: ${String((e as Error)?.message ?? e)}`
    } finally {
      busy = false
      projecting = false
    }
  }

  async function idXML() {
    busy = true
    error = null
    try {
      await exportIdXML(view.result)
    } catch (e) {
      error = `idXML: ${String((e as Error)?.message ?? e)}`
    } finally {
      busy = false
    }
  }
</script>

{#if error}
  <span class="max-w-72 truncate text-xs text-destructive" role="alert" title={error}>{error}</span>
{/if}
<DropdownMenu.Root {open} onOpenChange={openChange}>
  <DropdownMenu.Trigger class={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-7 gap-1 px-2.5 text-xs')} disabled={busy}>
    {#if projecting}Saving project…{:else if busy || view.exporting}Exporting…{:else}Export{/if}<ChevronDown class="size-3.5" aria-hidden="true" />
  </DropdownMenu.Trigger>
  <DropdownMenu.Content class="w-auto min-w-52" align="end">
    <DropdownMenu.Item disabled={view.level === null || view.exporting} onSelect={() => guard(() => exportCsv(view))}
      >CSV (current view)</DropdownMenu.Item>
    <DropdownMenu.Item onSelect={() => guard(() => exportDesign(view.result))}>Design (design.tsv)</DropdownMenu.Item>
    <DropdownMenu.Item
      disabled={!canSpectrum}
      title={canSpectrum ? undefined : 'Open a PSM whose spectrum is stored'}
      class={explained}
      onSelect={() => guard(() => view.spectrumExporter?.())}>Spectrum (SVG)</DropdownMenu.Item>
    <DropdownMenu.Item disabled={view.exporting} onSelect={project}>Project (.prose)</DropdownMenu.Item>
    <DropdownMenu.Separator />
    {#if canIdXML}
      <DropdownMenu.Item onSelect={idXML}>idXML (merged)</DropdownMenu.Item>
    {:else}
      <DropdownMenu.Item disabled title="ProSE writes a merged idXML for searches of several files" class={explained}
        >idXML (merged)</DropdownMenu.Item>
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>
