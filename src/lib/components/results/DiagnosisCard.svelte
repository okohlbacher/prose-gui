<script lang="ts">
  // "Why so few identifications?" (guidance G4): shown when a file's identification rate is unusual for the
  // setup, or far below the rest of the batch; at most three causes, each with its evidence and its fix.
  import FaqLink from '$lib/components/help/FaqLink.svelte'
  import Notice from '$lib/components/search/Notice.svelte'
  import { rerunWith } from '$lib/history/history.svelte'
  import { contaminantShare, diagnose, EXPECTED_ID_RATE, idRates, setupKind } from '$lib/results/diagnosis'
  import { precursorSample, searchedWindows, toleranceFindings } from '$lib/results/tolerance'
  import type { ResultsView } from '$lib/results/view.svelte'
  import { EXAMPLE } from '$lib/search/form.svelte'

  let { view }: { view: ResultsView } = $props()

  const result = $derived(view.result)
  const summary = $derived(result.outcome.summary)
  const parameters = $derived(result.settings.parameters)
  const kind = $derived(setupKind(parameters, summary.openSearch))
  const rows = $derived(idRates(summary, result.design, kind))
  const unusual = $derived(rows.filter((r) => r.low || r.outlier))
  const causes = $derived.by(() => {
    // (no preset hides them: the bound of the setup kind already allows for ion-trap and non-specific searches)
    if (unusual.length === 0) return []
    const tolerance = toleranceFindings(summary, parameters, precursorSample(view.model, searchedWindows(parameters).precursor, summary.openSearch))
    return diagnose(summary, tolerance, contaminantShare(view.model), result.settings.database === EXAMPLE.fasta)
  })
  const pct = (x: number | null) => (x === null ? 'no MS2' : `${(x * 100).toFixed(1)} %`)
  const names = $derived(unusual.length <= 3 ? unusual.map((r) => `${r.file} (${pct(r.rate)})`).join(', ') : `${unusual.length} files`)
</script>

{#if unusual.length > 0}
  <section aria-labelledby="overview-diagnosis" data-testid="diagnosis">
    <h2 id="overview-diagnosis" class="mb-1 text-[13px] font-semibold">Why so few identifications?</h2>
    <p class="mb-2 text-xs text-muted-foreground">
      Identified spectra per MS2 spectrum: {names}. A search of this kind usually identifies at least {pct(EXPECTED_ID_RATE[kind])}{unusual.some((r) => r.outlier && !r.low)
        ? ', and these files are far below the others of the batch'
        : ''}.
    </p>
    {#if causes.length > 0}
      <div class="flex flex-col gap-1.5">
        {#each causes as c (c.id)}
          <Notice>
            {c.message}
            {#each c.reruns as r (r.label)}
              <button type="button" class="ml-2 underline underline-offset-2 hover:no-underline" onclick={() => void rerunWith(result, r.changes)}>{r.label}</button>
            {/each}
            <FaqLink check={c.id} faq={c.help?.id} />
          </Notice>
        {/each}
      </div>
    {:else}
      <p class="text-xs text-muted-foreground">
        The search reports nothing that explains it. Check the sample preparation (alkylation, labels, enzyme) and the organism of the
        database against your protocol, and compare with a good run of the same instrument.<FaqLink check="low-id-rate" />
      </p>
    {/if}
  </section>
{/if}
