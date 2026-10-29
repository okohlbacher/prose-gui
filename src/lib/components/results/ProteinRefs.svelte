<script lang="ts">
  // The proteins of a peptide in a table cell: the first accession and how many more, or "below
  // protein FDR" when all of its proteins failed the protein FDR (the engine then lists none).
  import { parseAccession } from '$lib/results/display'
  import type { ResultModel } from '$lib/results/model'
  import Marker from './Marker.svelte'

  // `onOpen`: the accession is a link to the protein's panel (it does not open the row it sits in)
  let { model, peptide, onOpen }: { model: ResultModel; peptide: number; onOpen?: (protein: number) => void } = $props()

  const proteins = $derived(model.peptide.proteins[peptide])
  const first = $derived(proteins.length > 0 ? parseAccession(model.tables.proteins.accession[proteins[0]]) : null)
</script>

{#if first === null}
  <span class="text-muted-foreground italic" title="None of this peptide's proteins pass the protein FDR">below protein FDR</span>
{:else}
  {#if onOpen}<button
      type="button"
      tabindex={-1}
      class="font-mono text-[12.5px] text-primary underline-offset-2 hover:underline"
      title="Open {first.id} in the Proteins tab"
      onclick={(e) => {
        e.stopPropagation()
        onOpen(proteins[0])
      }}>{first.id}</button
    >{:else}<span class="font-mono text-[12.5px]">{first.id}</span>{/if}{#if proteins.length > 1}<span class="text-muted-foreground">
      +{proteins.length - 1}</span
    >{/if}{#if model.peptide.contaminant[peptide]}<Marker text="contaminant" />{/if}
{/if}
