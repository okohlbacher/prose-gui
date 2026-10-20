<script lang="ts">
  // History (a stub: the folders of the finished searches, with open, rename, delete and project files,
  // come with History proper). For now it points to the search of this session, which Results holds.
  import { formatHash } from '$lib/route'
  import { exportName } from '$lib/results/exports'
  import { openResult } from '$lib/search/session.svelte'
</script>

<section data-testid="view-history" class="flex flex-col gap-4">
  <div>
    <h1 class="mb-1 text-xl font-semibold tracking-tight">History</h1>
    <p class="text-muted-foreground">Finished searches are kept on this computer with their results.</p>
  </div>
  <div class="rounded-lg border border-dashed bg-background px-6 py-10 text-center" data-testid="history-empty">
    <p class="text-sm font-medium">No saved searches yet</p>
    <p class="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
      {#if openResult.current}
        The search of this session is open in
        <a class="text-foreground underline-offset-2 hover:underline" href={formatHash({ view: 'results', id: openResult.current.id })}
          >Results ({exportName(openResult.current)})</a
        >.
      {:else}
        A finished search opens in Results.
      {/if}
    </p>
  </div>
</section>
