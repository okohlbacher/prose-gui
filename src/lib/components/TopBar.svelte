<script lang="ts">
  import { formatHash, type Route, type View } from '$lib/route'
  import { cn } from '$lib/utils'

  let { route, resultId }: { route: Route; resultId: string | null } = $props()

  const items: { view: View; label: string }[] = [
    { view: 'search', label: 'New search' },
    { view: 'results', label: 'Results' },
    { view: 'history', label: 'History' },
  ]

  // "Results" returns to the result that was open last
  function hrefOf(view: View): string {
    return formatHash(view === 'results' ? { view, id: resultId } : { view })
  }
</script>

<!-- One row of 52 px, as the web app's top bar (its subtitle hides at 1100 px or less, the gaps narrow).
     The right-hand group (the engine chip, the result's Export menu) comes with the screens that fill it. -->
<header
  class="flex min-h-[52px] flex-wrap items-center gap-x-6 gap-y-1.5 border-b bg-background px-5 py-2.5 *:shrink-0 max-[1101px]:gap-x-4">
  <div class="text-[15px] font-semibold tracking-tight whitespace-nowrap">
    ProSE<small class="ml-1.5 text-xs font-normal text-muted-foreground max-[1101px]:hidden">OpenMS search engine</small>
  </div>
  <nav aria-label="Main" class="flex gap-1">
    {#each items as item (item.view)}
      {@const active = route.view === item.view}
      <a
        href={hrefOf(item.view)}
        aria-current={active ? 'page' : undefined}
        class={cn(
          'rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
          active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}>{item.label}</a
      >
    {/each}
  </nav>
  <div class="ml-auto flex items-center gap-x-6 max-[1101px]:gap-x-4"></div>
</header>
