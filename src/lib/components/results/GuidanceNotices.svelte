<script lang="ts">
  // Guidance about a result (tolerance feedback, diagnosis causes): amber notices, each with its re-runs, which
  // open New search with the changed values marked (`rerunWith`). Never blocking, never changes the result.
  import FaqLink from '$lib/components/help/FaqLink.svelte'
  import Notice from '$lib/components/search/Notice.svelte'
  import { rerunWith } from '$lib/history/history.svelte'
  import type { OpenResult } from '$lib/search/session.svelte'

  type Item = { id?: string; message: string; reruns: { label: string; changes: Record<string, unknown> }[] }
  let { result, items, testid = 'guidance' }: { result: OpenResult; items: Item[]; testid?: string } = $props()
</script>

{#if items.length > 0}
  <div class="flex flex-col gap-1.5" data-testid={testid}>
    {#each items as item, k (k)}
      <Notice>
        {item.message}
        {#each item.reruns as r (r.label)}
          <button type="button" class="ml-2 underline underline-offset-2 hover:no-underline" onclick={() => void rerunWith(result, r.changes)}>{r.label}</button>
        {/each}
        <FaqLink check={item.id} />
      </Notice>
    {/each}
  </div>
{/if}
