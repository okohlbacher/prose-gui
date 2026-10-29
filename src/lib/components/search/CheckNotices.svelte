<script lang="ts">
  // The advice of New search (`searchPlan.advice`: warn and info checks of `checks.ts`) above the footer: amber
  // notices, never blocking, each with its fix where it has one. Red flags that block are in the plan line.
  import { searchPlan as plan } from '$lib/search/plan.svelte'
  import NoticeList from './NoticeList.svelte'

  const items = $derived(plan.advice.filter((c) => c.level !== 'block').map((c) => ({ message: c.message, action: c.action, help: c.id })))
</script>

{#if items.length > 0}
  <div class="flex flex-col gap-1.5" data-testid="check-notices">
    <NoticeList {items} />
  </div>
{/if}
