<script lang="ts">
  // Checks of the finished search (guidance G11): what may have gone wrong silently, and what ProSE recorded of
  // the settings beside what was set (the parameter echo, folded).
  import FaqLink from '$lib/components/help/FaqLink.svelte'
  import Notice from '$lib/components/search/Notice.svelte'
  import { parameterEcho, sanityFindings } from '$lib/results/sanity'
  import type { ResultsView } from '$lib/results/view.svelte'

  let { view }: { view: ResultsView } = $props()
  const result = $derived(view.result)
  const findings = $derived(
    sanityFindings({
      summary: result.outcome.summary,
      model: view.model,
      files: result.design.rows.map((r) => r.fileName),
      spectra: result.spectra,
      parameters: result.settings.parameters,
      provenance: result.outcome.provenance,
    }),
  )
  const echo = $derived(parameterEcho(result.settings.parameters, result.outcome.provenance))
</script>

{#if findings.length > 0 || echo.length > 0}
  <section aria-labelledby="overview-sanity" data-testid="sanity">
    <h2 id="overview-sanity" class="mb-2 text-[13px] font-semibold">Checks of the search</h2>
    <div class="flex flex-col gap-1.5">
      {#each findings as f, k (k)}<Notice>{f.message}<FaqLink check={f.id} /></Notice>{/each}
      {#if findings.length === 0}<p class="text-xs text-muted-foreground">Every input gave a run, the decoys were recognised, and ProSE used the settings as set.</p>{/if}
      {#if echo.length > 0}
        <details class="text-xs" data-testid="parameter-echo">
          <summary class="cursor-pointer text-muted-foreground hover:text-foreground">What ProSE used</summary>
          <dl class="mt-1 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5">
            {#each echo as e (e.name)}
              <dt class="text-muted-foreground">{e.name}</dt>
              <dd class={e.same ? '' : 'font-medium text-amber-700 dark:text-amber-400'}>{e.used}{e.same ? '' : ` (set: ${e.asked})`}</dd>
            {/each}
          </dl>
        </details>
      {/if}
    </div>
  </section>
{/if}
