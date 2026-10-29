<script lang="ts">
  // The Exists cell of a design-table row while an SDRF is loaded: whether the SDRF's data file was found,
  // with the path it resolved to in the tooltip. A file added by hand shows a dash.
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check'
  import FileCogIcon from '@lucide/svelte/icons/file-cog'
  import * as Tooltip from '$lib/components/ui/tooltip'
  import { sdrfSession, STATUS_TEXT } from '$lib/design/sdrf-session.svelte'

  let { path }: { path: string } = $props()
  const file = $derived(sdrfSession.fileAt(path))
</script>

{#if file}
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <span {...props} class="inline-flex" aria-label="{STATUS_TEXT[file.status]}: {file.path}" data-testid="sdrf-status" data-status={file.status}>
          {#if file.status === 'mzml'}<FileCogIcon class="size-4 text-emerald-600" />{:else}<CircleCheckIcon class="size-4 text-emerald-600" />{/if}
        </span>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content class="max-w-md" role="tooltip"
      >{STATUS_TEXT[file.status]}{file.status === 'mzml' ? ` (the SDRF names ${file.name})` : ''}: {file.path}</Tooltip.Content>
  </Tooltip.Root>
{:else}
  <span class="text-muted-foreground" title="Added by hand, not from the SDRF">–</span>
{/if}
