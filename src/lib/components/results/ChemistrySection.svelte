<script lang="ts">
  // The sample chemistry of a result (guidance G2): cysteine peptides against the proteins, label occupancy,
  // missed and non-specific cleavages of the passing target peptides, and what looks off.
  import FaqLink from '$lib/components/help/FaqLink.svelte'
  import Notice from '$lib/components/search/Notice.svelte'
  import { chemistryCard } from '$lib/results/chemistry'
  import type { ResultsView } from '$lib/results/view.svelte'

  let { view }: { view: ResultsView } = $props()
  const card = $derived(chemistryCard(view.model, view.result.settings.parameters, view.result.settings.fixedMods))
  const pct = (x: number) => `${(x * 100).toFixed(1)} %`
  const facts = $derived(
    card
      ? [
          card.cysteine ? { name: 'Peptides with a cysteine', value: `${pct(card.cysteine.observed)} (expected about ${pct(card.cysteine.expected)})` } : null,
          card.missedCleavages !== null ? { name: 'Missed cleavages', value: pct(card.missedCleavages) } : null,
          card.nonSpecific !== null ? { name: 'Non-specific ends', value: pct(card.nonSpecific) } : null,
          card.labelOccupancy !== null ? { name: 'Label on K', value: pct(card.labelOccupancy) } : null,
        ].filter((f) => f !== null)
      : [],
  )
</script>

{#if card && facts.length > 0}
  <section aria-labelledby="overview-chemistry" data-testid="chemistry">
    <h2 id="overview-chemistry" class="mb-1 text-[13px] font-semibold">Sample chemistry</h2>
    <p class="mb-2 text-xs text-muted-foreground">Of the {card.peptides.toLocaleString('en-US')} passing target peptides.</p>
    <dl class="mb-2 grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-x-6 gap-y-2 text-xs">
      {#each facts as f (f.name)}
        <div><dt class="text-muted-foreground">{f.name}</dt><dd>{f.value}</dd></div>
      {/each}
    </dl>
    <div class="flex flex-col gap-1.5">{#each card.notes as note, k (k)}<Notice>{note}<FaqLink check={card.noteIds[k]} /></Notice>{/each}</div>
  </section>
{/if}
