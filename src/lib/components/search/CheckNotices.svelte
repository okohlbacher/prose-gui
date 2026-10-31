<script lang="ts">
  // The advice of New search (`searchPlan.advice`: warn and info checks of `checks.ts`) above the footer: amber
  // notices, never blocking, each with its fix where it has one, and the red flags accepted for these files. Red
  // flags that block are in the plan line.
  import { searchPlan as plan } from '$lib/search/plan.svelte'
  import NoticeList from './NoticeList.svelte'

  const items = $derived([
    // red flags searched anyway: said, and undone with "Ask again" (else they would be gone for good on this computer)
    ...plan.acceptedFlags.map((c) => ({ message: `Searched anyway: ${c.message}`, action: { label: 'Ask again', run: () => plan.askAgain(c) }, help: c.id, info: true })),
    ...plan.advice.filter((c) => c.level !== 'block').map((c) => ({ message: c.message, action: c.action, help: c.id, info: c.level === 'info' })),
  ])
</script>

{#if items.length > 0}
  <div class="flex flex-col gap-1.5" data-testid="check-notices">
    <NoticeList {items} />
  </div>
{/if}
