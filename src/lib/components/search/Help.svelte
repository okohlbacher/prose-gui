<script lang="ts">
  // A "?" beside a field's label that opens its explanation (click, keyboard or touch, not only hover).
  import CircleHelp from '@lucide/svelte/icons/circle-help'
  import * as Popover from '$lib/components/ui/popover'
  import { openHelp } from '$lib/help-link.svelte'
  import { HELP, type HelpKey } from '$lib/settings/help'

  let { topic }: { topic: HelpKey } = $props()
  const help: { title: string; text: string; tip?: string } = $derived(HELP[topic])
</script>

<Popover.Root>
  <Popover.Trigger
    class="inline-flex size-4 items-center justify-center rounded-full align-middle text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
    aria-label="What is {help.title}?">
    <CircleHelp class="size-3.5" />
  </Popover.Trigger>
  <Popover.Content class="w-80 text-xs leading-relaxed" align="start">
    <p class="mb-1 font-semibold">{help.title}</p>
    <p>{help.text}</p>
    {#if help.tip}<p class="mt-1.5 text-muted-foreground">{help.tip}</p>{/if}
    <button type="button" class="mt-2 text-primary underline underline-offset-2" onclick={() => openHelp(`help-${topic}`)}>More in Help ›</button>
  </Popover.Content>
</Popover.Root>
