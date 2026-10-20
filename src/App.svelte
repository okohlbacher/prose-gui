<script lang="ts">
  import TopBar from '$lib/components/TopBar.svelte'
  import * as Tooltip from '$lib/components/ui/tooltip'
  import { readHash, router } from '$lib/route.svelte'

  readHash()
</script>

<svelte:window onhashchange={readHash} />

<Tooltip.Provider delayDuration={300}>
  <div class="min-h-screen bg-muted/40">
    <TopBar route={router.route} resultId={router.resultId} />
    <main class="mx-auto max-w-[1120px] px-5 pt-6 pb-24"></main>
  </div>
</Tooltip.Provider>
