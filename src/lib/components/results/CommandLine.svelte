<script lang="ts">
  // "Copy command line" of a search (guidance G8): ProSE's command as the app ran it, the parameters in the
  // search's prose.ini; paths as placeholders, or (with paths) the inputs and the database of this computer.
  import { commandLineOf } from '$lib/history/history.svelte'

  let { id, compact = false }: { id: string; compact?: boolean } = $props()
  let copied = $state<string | null>(null)
  let missing = $state(false)

  async function copy(withPaths: boolean) {
    const line = await commandLineOf(id, withPaths)
    if (line === null) {
      missing = true
      return
    }
    await navigator.clipboard.writeText(line)
    copied = withPaths ? 'with paths' : 'plain'
    setTimeout(() => (copied = null), 1500)
  }
  const button = $derived(
    compact
      ? 'h-6 rounded-md px-2 text-xs font-medium hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none'
      : 'rounded-md border px-2 py-0.5 text-xs hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
  )
</script>

<span class="inline-flex items-center gap-2" data-testid="command-line">
  <button type="button" class={button} title="ProSE's command line, the paths as placeholders; the parameters are in the search's prose.ini" onclick={() => copy(false)}
    >{copied === 'plain' ? 'Copied' : compact ? 'Command line' : 'Copy command line'}</button>
  {#if !compact}
    <button type="button" class={button} title="With the paths of the inputs and the database on this computer" onclick={() => copy(true)}
      >{copied === 'with paths' ? 'Copied' : 'With paths'}</button>
  {/if}
  {#if missing}<span class="text-xs text-muted-foreground">This search was made before the app kept its command line.</span>{/if}
</span>
