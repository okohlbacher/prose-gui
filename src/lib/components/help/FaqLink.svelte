<script lang="ts">
  // "What to do ›" beside a check, finding or diagnosis cause: opens the Help troubleshooting entry for its id
  // (`settings/faq.ts`); nothing when there is none. `faq` names an entry directly (a diagnosis cause's own help).
  import { openHelp } from '$lib/help-link.svelte'
  import { faqFor } from '$lib/settings/faq'

  let { check, faq, label = 'What to do ›' }: { check?: string | null; faq?: string | null; label?: string } = $props()
  const target = $derived(faq ?? (check ? faqFor(check)?.id : undefined) ?? null)
</script>

{#if target}
  <button type="button" class="ml-2 underline underline-offset-2 hover:no-underline" data-testid="faq-link" onclick={() => openHelp(target!)}>{label}</button>
{/if}
