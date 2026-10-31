<script lang="ts">
  // A notice of the design table: amber, never blocking (spec: gaps and duplicates are notices); `info`: a neutral
  // note (what is not checked, what is merely unusual), not drawn like advice to act on.
  import InfoIcon from '@lucide/svelte/icons/info'
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert'
  import XIcon from '@lucide/svelte/icons/x'
  import type { Snippet } from 'svelte'

  let { children, onDismiss, info = false }: { children: Snippet; onDismiss?: () => void; info?: boolean } = $props()
</script>

<!-- not a live region itself: NoticeList announces the notices once -->
<div
  data-slot="notice"
  data-level={info ? 'info' : 'warn'}
  class={info
    ? 'flex items-start gap-2 rounded-md border bg-muted/40 px-2.5 py-2 text-[12.5px] text-muted-foreground'
    : 'flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[12.5px] text-amber-900 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200'}>
  {#if info}
    <InfoIcon class="mt-px size-3.5 shrink-0" aria-label="Information" />
  {:else}
    <TriangleAlertIcon class="mt-px size-3.5 shrink-0" aria-label="Advice" />
  {/if}
  <div class="min-w-0 flex-1">{@render children()}</div>
  {#if onDismiss}
    <button
      type="button"
      class="-m-0.5 rounded p-0.5 text-amber-800 hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-amber-400 dark:text-amber-300 dark:hover:bg-amber-400/15 focus-visible:outline-none"
      aria-label="Dismiss"
      onclick={onDismiss}><XIcon class="size-3.5" /></button>
  {/if}
</div>
