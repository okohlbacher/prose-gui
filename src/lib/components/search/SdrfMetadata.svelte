<script lang="ts">
  // "Metadata…" of the SDRF panel: what the loaded SDRF says about its study (sdrfSummary), section by section,
  // each value with the rows that have it; below, the whole table as it is, to scroll through.
  import * as Dialog from '$lib/components/ui/dialog'
  import { sdrfSession as sdrf } from '$lib/design/sdrf-session.svelte'
  import { sdrfSummary } from '$lib/design/sdrf-summary'

  let { open = $bindable(false) }: { open?: boolean } = $props()
  const sections = $derived(open && sdrf.table ? sdrfSummary(sdrf.table) : [])
  const rows = $derived(sdrf.table?.rows.filter((r) => r.some((c) => c.trim() !== '')) ?? [])
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[85vh] gap-3 overflow-y-auto sm:max-w-3xl" data-testid="sdrf-metadata">
    <Dialog.Header>
      <Dialog.Title>Metadata of {sdrf.name}</Dialog.Title>
      <Dialog.Description>What the SDRF says about the study. Values with how many of its rows have them.</Dialog.Description>
    </Dialog.Header>
    {#each sections as s (s.title)}
      <section>
        <h3 class="mb-1 text-[13px] font-semibold">{s.title}</h3>
        <dl class="grid grid-cols-[11rem_1fr] gap-x-4 gap-y-1 text-xs">
          {#each s.items as item (item.label)}
            <dt class="text-muted-foreground">{item.label}</dt>
            <dd class="min-w-0">
              {#each item.values as v, i (v.value)}
                <span class="break-words">{v.value}</span>{#if item.values.length > 1 || s.title !== 'Study'}<span class="text-muted-foreground tabular-nums">
                    × {v.rows}</span
                  >{/if}{#if i < item.values.length - 1}<span class="text-muted-foreground"> · </span>{/if}
              {/each}
            </dd>
          {/each}
        </dl>
      </section>
    {/each}
    {#if sdrf.table}
      <details class="text-xs">
        <summary class="cursor-pointer text-muted-foreground hover:text-foreground">The whole table ({rows.length} rows, {sdrf.table.headers.length} columns)</summary>
        <div class="mt-2 max-h-80 overflow-auto rounded-md border">
          <table class="text-[11.5px] whitespace-nowrap">
            <thead class="sticky top-0 bg-muted">
              <tr>{#each sdrf.table.headers as h, i (i)}<th class="border-b px-2 py-1 text-left font-medium">{h}</th>{/each}</tr>
            </thead>
            <tbody>
              {#each rows as r, k (k)}
                <tr class="border-b last:border-0">{#each sdrf.table.headers as _, i (i)}<td class="px-2 py-0.5">{r[i] ?? ''}</td>{/each}</tr>
              {/each}
            </tbody>
          </table>
        </div>
      </details>
    {/if}
  </Dialog.Content>
</Dialog.Root>
