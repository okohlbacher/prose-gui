<script lang="ts">
  // The Samples tab's SDRF table: the characteristics[...] and factor value[...] of each searched file, from the
  // SDRF the search was started with, joined on the file stem (`sdrfAnnotations`).
  import * as Table from '$lib/components/ui/table'
  import type { DesignResolution } from '$lib/design/model'
  import { parseSdrfTable, sdrfAnnotations } from '$lib/design/sdrf-table'

  let { sdrf, design }: { sdrf: { name: string; text: string }; design: DesignResolution } = $props()

  const a = $derived(
    sdrfAnnotations(
      parseSdrfTable(sdrf.text),
      design.rows.map((r) => ({ fileName: r.fileName, sample: design.samples[r.sample]?.label ?? '' })),
    ),
  )
  const head = 'h-auto border-b px-2.5 py-1.5 text-left font-medium text-muted-foreground whitespace-nowrap'
  const cell = 'border-b px-2.5 py-1.5 whitespace-nowrap'
</script>

<div class="flex flex-col gap-1.5" data-testid="sdrf-samples">
  <p class="text-xs text-muted-foreground">Sample annotations from {sdrf.name}.</p>
  <div class="overflow-auto rounded-lg border bg-background">
    <Table.Root class="text-xs" aria-label="SDRF annotations by file">
      <Table.Header>
        <Table.Row class="hover:bg-transparent">
          <Table.Head scope="col" class={head}>File</Table.Head>
          <Table.Head scope="col" class={head}>Sample</Table.Head>
          {#if a.label}<Table.Head scope="col" class={head}>Label</Table.Head>{/if}
          {#each a.headers as h, k (k)}<Table.Head scope="col" class={head}>{h}</Table.Head>{/each}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each a.rows as r, k (k)}
          <Table.Row>
            <Table.Cell class="{cell} font-mono">{r.fileName}</Table.Cell>
            <Table.Cell class={cell}>{r.sample}</Table.Cell>
            {#if a.label}<Table.Cell class={cell}>{r.label}</Table.Cell>{/if}
            {#each r.values as v, c (c)}<Table.Cell class={cell}>{v}</Table.Cell>{/each}
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>
</div>
