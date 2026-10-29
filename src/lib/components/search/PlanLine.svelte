<script lang="ts">
  // The footer's text: the one-line plan (in full as its title: the footer may cut it), and beneath it the
  // example's note (it wraps), why the search cannot start, or how the last search ended. A red flag that stops
  // the search (`checks.ts`) has "Search anyway" beside it: the user is asked once per file.
  import FaqLink from '$lib/components/help/FaqLink.svelte'
  import { searchPlan as plan } from '$lib/search/plan.svelte'
  import { searchRun } from '$lib/search/session.svelte'
</script>

<div class="min-w-0 flex-1">
  <p class="truncate text-xs text-muted-foreground" data-testid="search-plan" title={plan.line}>{plan.line}</p>
  {#if plan.note && !plan.problemShown}
    <p class="line-clamp-2 text-xs leading-tight text-muted-foreground" data-testid="search-note">{plan.note}</p>
  {/if}
  {#if plan.problemShown}
    <p class="flex min-w-0 items-baseline gap-2 text-xs text-foreground">
      <span class="truncate" id="start-problem" title={plan.problem}>{plan.problem}</span>
      {#if plan.blocking?.overridable}
        <button
          type="button"
          class="shrink-0 underline underline-offset-2 hover:no-underline"
          data-testid="search-anyway"
          title="Start is allowed for these files from now on; the search records that you chose to search them anyway."
          onclick={() => plan.searchAnyway()}>Search anyway</button>
      {/if}
      <span class="shrink-0"><FaqLink check={plan.blocking?.id} /></span>
    </p>
  {:else if searchRun.status === 'cancelled'}
    <p class="text-xs text-muted-foreground">The search was cancelled.</p>
  {:else if searchRun.status === 'failed'}
    <p class="text-xs text-destructive">
      {searchRun.failure?.searchId ? 'The results could not be read' : 'The search stopped'}: see the message above.
    </p>
  {/if}
</div>
