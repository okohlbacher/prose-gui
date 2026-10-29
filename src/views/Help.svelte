<script lang="ts">
  // Help: six pages (`HELP_PAGES`, #/help/<page>) beside a navigation, troubleshooting first for someone whose search
  // just went wrong: what to do about each check (`settings/faq.ts`), how to read the results, decoys and the FDR,
  // the settings, how a search works (with drawings and animations), and where to learn more. The pages are in
  // `views/help/`; their shared look is here (`:global` under `.help`).
  import { helpTarget } from '$lib/help-link.svelte'
  import { HELP_PAGES, type HelpPage } from '$lib/route'
  import { navigate, router } from '$lib/route.svelte'
  import { shortcuts } from '$lib/shortcuts.svelte'
  import { tick } from 'svelte'
  import { revealSection } from './help/reveal'
  import HelpBasics from './help/HelpBasics.svelte'
  import HelpFdr from './help/HelpFdr.svelte'
  import HelpFormats from './help/HelpFormats.svelte'
  import HelpLearn from './help/HelpLearn.svelte'
  import HelpResults from './help/HelpResults.svelte'
  import HelpSettings from './help/HelpSettings.svelte'
  import HelpTroubleshooting from './help/HelpTroubleshooting.svelte'

  const LABELS: Record<HelpPage, string> = {
    troubleshooting: 'Troubleshooting',
    results: 'Reading the results',
    fdr: 'Decoys and the FDR',
    settings: 'The settings',
    formats: 'File formats',
    basics: 'How a search works',
    learn: 'Videos and links',
  }

  const page = $derived<HelpPage>(router.route.view === 'help' ? (router.route.page ?? 'troubleshooting') : 'troubleshooting')

  // the section asked for from elsewhere in the app (a "More in Help" or "What to do" link): kept for the page (the
  // troubleshooting page opens that entry), scrolled to once the page has rendered
  // (an object, so that asking for the same section again counts as a new request)
  let target = $state<{ id: string } | null>(null)
  // (not reactive: whether a section is being shown, so that the change of page does not scroll to the top)
  let revealing = false
  $effect(() => {
    const id = helpTarget.id
    if (id === null) return
    helpTarget.id = null
    revealing = true
    target = { id }
    void tick()
      .then(tick)
      .then(() => {
        revealSection(id)
        revealing = false
      })
  })

  // a page opened without a section (the navigation, or a link to the page) starts at its top
  let shown: HelpPage | null = null
  $effect(() => {
    const p = page
    if (p === shown) return
    shown = p
    if (revealing) return
    void tick().then(() => document.getElementById('help-top')?.scrollIntoView({ block: 'start' }))
  })

  function show(p: HelpPage) {
    target = null
    navigate({ view: 'help', page: p })
  }
</script>

<article class="help mx-auto flex max-w-[1080px] flex-col gap-5 pb-10 text-[13px] leading-relaxed md:flex-row md:gap-8" data-testid="view-help">
  <nav class="shrink-0 md:sticky md:top-0 md:w-48 md:self-start" aria-label="Help pages">
    <h1 class="mb-2 text-xl font-semibold tracking-tight" id="help-top">Help</h1>
    <!-- (buttons, not #anchors: the hash is the app's route) -->
    <ul class="pages flex flex-wrap gap-x-4 gap-y-1 text-[13px] md:flex-col md:gap-0.5">
      {#each HELP_PAGES as p (p)}
        <li>
          <button
            type="button"
            class="page-link w-full rounded-md text-left md:px-2 md:py-1 {p === page ? 'current' : ''}"
            aria-current={p === page ? 'page' : undefined}
            data-testid="help-page-{p}"
            onclick={() => show(p)}>{LABELS[p]}</button>
        </li>
      {/each}
      <li>
        <button type="button" class="page-link w-full rounded-md text-left text-muted-foreground md:mt-2 md:px-2 md:py-1" onclick={() => (shortcuts.open = true)}>Keyboard shortcuts</button>
      </li>
    </ul>
  </nav>

  <div class="min-w-0 max-w-[860px] flex-1" data-testid="help-page">
    {#if page === 'troubleshooting'}
      <HelpTroubleshooting {target} />
    {:else if page === 'results'}
      <HelpResults />
    {:else if page === 'fdr'}
      <HelpFdr />
    {:else if page === 'settings'}
      <HelpSettings />
    {:else if page === 'formats'}
      <HelpFormats />
    {:else if page === 'basics'}
      <HelpBasics />
    {:else}
      <HelpLearn />
    {/if}
  </div>
</article>

<style>
  .help .page-link {
    color: var(--color-primary);
  }
  .help .page-link.current {
    color: var(--color-primary);
    font-weight: 500;
  }
  .help .page-link:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 1px;
  }
  @media (min-width: 768px) {
    .help .page-link {
      color: var(--color-foreground);
    }
    .help .page-link:hover {
      background: var(--color-muted);
    }
    .help .page-link.current {
      background: color-mix(in oklch, var(--color-primary) 10%, transparent);
      color: var(--color-primary);
    }
  }
  .help :global(table.formats) {
    margin: 0.5rem 0;
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }
  .help :global(table.formats th),
  .help :global(table.formats td) {
    border-bottom: 1px solid var(--color-border);
    padding: 0.35rem 0.5rem;
    text-align: left;
    vertical-align: top;
  }
  .help :global(table.formats th) {
    font-weight: 600;
    color: var(--color-muted-foreground);
  }
  .help :global(code) {
    font-family: var(--font-mono, ui-monospace);
    font-size: 0.92em;
  }
  .help :global(h2) {
    margin-bottom: 0.5rem;
    font-size: 15px;
    font-weight: 600;
    scroll-margin-top: 1rem;
  }
  .help :global(h3) {
    margin: 0.75rem 0 0.25rem;
    font-size: 13px;
    font-weight: 600;
    scroll-margin-top: 1rem;
  }
  .help :global(section + section) {
    margin-top: 2rem;
  }
  .help :global(section > * + p),
  .help :global(section > * + ul),
  .help :global(section > * + ol),
  .help :global(section > * + dl) {
    margin-top: 0.6rem;
  }
  .help :global(.prose-list) {
    list-style: disc;
    padding-left: 1.25rem;
  }
  .help :global(ol.prose-list) {
    list-style: decimal;
  }
  .help :global(.prose-list li + li) {
    margin-top: 0.3rem;
  }
  .help :global(a),
  .help :global(.jump) {
    color: var(--color-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .help :global(figure) {
    margin: 1rem 0;
    border: 1px solid var(--color-border);
    border-radius: 0.6rem;
    background: var(--color-background);
    padding: 0.75rem 1rem;
  }
  .help :global(figcaption) {
    margin-top: 0.4rem;
    font-size: 12px;
    color: var(--color-muted-foreground);
  }
  .help :global(svg) {
    width: 100%;
    height: auto;
    font-family: inherit;
    font-size: 12px;
  }
  .help :global(svg text) {
    fill: var(--color-foreground);
  }
  .help :global(svg .sub) {
    fill: var(--color-muted-foreground);
    font-size: 11px;
  }
  .help :global(svg .aa) {
    font-family: var(--font-sequence, ui-monospace);
    font-size: 18px;
    font-weight: 600;
  }
  .help :global(svg .box),
  .help :global(svg .step rect) {
    fill: var(--color-muted);
    stroke: var(--color-border);
  }
  .help :global(svg .step.hl rect) {
    stroke: var(--color-primary);
    stroke-width: 2;
  }
  .help :global(svg .cut) {
    stroke: var(--color-muted-foreground);
    stroke-dasharray: 3 3;
  }
  .help :global(svg .axis) {
    stroke: var(--color-muted-foreground);
  }
  .help :global(svg .arrow) {
    fill: none;
    stroke: var(--color-muted-foreground);
    stroke-width: 1.5;
  }
  .help :global(.settings > div) {
    border-top: 1px solid var(--color-border);
    padding: 0.5rem 0;
    scroll-margin-top: 1rem;
  }
  .help :global(dt) {
    font-weight: 600;
  }
  .help :global(.tip) {
    color: var(--color-muted-foreground);
  }
  .help :global(code) {
    font-family: var(--font-sequence, ui-monospace);
    font-size: 12px;
    overflow-wrap: anywhere;
  }
</style>
