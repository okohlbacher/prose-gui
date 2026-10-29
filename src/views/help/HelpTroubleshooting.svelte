<script lang="ts">
  // Help › Troubleshooting: what the checks of the app mean and cannot see, then every FAQ entry (`settings/faq.ts`)
  // by its group, each a <details> with the entry's id, so that "What to do ›" beside a check opens it (`target`).
  // A search box filters the entries by their text.
  import { FAQ, FAQ_GROUPS, type FaqEntry } from '$lib/settings/faq'
  import { tick } from 'svelte'

  let { target = null }: { target?: { id: string } | null } = $props()

  let query = $state('')
  /** The entry opened from elsewhere, or by a quick link here. */
  let opened = $state<string | null>(null)
  $effect(() => {
    if (target === null || !target.id.startsWith('faq-')) return
    query = ''
    opened = target.id
  })

  const text = (e: FaqEntry) => [e.question, e.symptoms, ...e.causes, ...e.fixes, e.outside ?? ''].join(' ').toLowerCase()
  const words = $derived(query.toLowerCase().split(/\s+/).filter(Boolean))
  const shown = $derived(FAQ.filter((e) => words.every((w) => text(e).includes(w))))
  const groups = $derived(FAQ_GROUPS.map((g) => ({ ...g, entries: shown.filter((e) => e.group === g.id) })).filter((g) => g.entries.length > 0))

  function go(id: string) {
    query = ''
    opened = id
    void tick().then(() => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }
</script>

<section id="troubleshooting-intro" aria-labelledby="troubleshooting-h">
  <h2 id="troubleshooting-h">Troubleshooting</h2>
  <p>
    Search went wrong? Start with
    <button type="button" class="jump" onclick={() => go('faq-few-ids')}>few or no identifications</button>,
    <button type="button" class="jump" onclick={() => go('faq-settings-rejected')}>the search will not start</button>, or
    <button type="button" class="jump" onclick={() => go('faq-decoys-fdr')}>the FDR looks wrong</button>. The “What to do ›” beside a
    message of the app opens its entry here.
  </p>
  <h3 id="troubleshooting-checks">What the checks mean, and what they cannot see</h3>
  <ul class="prose-list">
    <li><b>Red</b> (in the line beside Start): the search cannot start until it is fixed.</li>
    <li>
      Some red flags (profile spectra, no MS2 spectra) offer <b>Search anyway</b>: it searches the files as they are, changes nothing
      in them, is remembered for those files on this computer, and is recorded with the search and in its methods text.
    </li>
    <li><b>Amber</b> notices are advice: the search can start, and after it the Overview cards say what may have gone wrong.</li>
    <li>
      Before Start, the app reads the flags of the first 200 MS2 spectra of mzML files: whether they are flagged centroid or
      profile, their charges, activation and isolation windows. It does not look at the peaks, so a mislabelled file passes; Thermo
      .raw, Bruker .d and mzPeak files are checked only after the search.
    </li>
    <li>No warning does not mean the data or settings are right: the checks catch what they can see.</li>
  </ul>
</section>

<section id="troubleshooting-faq" aria-labelledby="faq-h">
  <h2 id="faq-h" class="sr-only">Questions</h2>
  <div class="mb-3 flex items-center gap-2">
    <label for="faq-search" class="text-xs text-muted-foreground">Search the questions</label>
    <input
      id="faq-search"
      type="search"
      bind:value={query}
      placeholder="e.g. profile, decoys, charge"
      class="h-7 w-64 max-w-full rounded-md border bg-background px-2 text-xs"
      data-testid="faq-search" />
    {#if query && shown.length === 0}<span class="text-xs text-muted-foreground">No entry matches.</span>{/if}
  </div>

  {#each groups as g (g.id)}
    <h3 id="faq-group-{g.id}">{g.title}</h3>
    <div class="flex flex-col gap-1.5">
      {#each g.entries as e (e.id)}
        <details id={e.id} class="faq" open={opened === e.id || words.length > 0}>
          <summary>{e.question}</summary>
          <div class="body">
            <p>{e.symptoms}</p>
            <p class="label">Likely causes, most likely first</p>
            <ol class="prose-list">
              {#each e.causes as c, k (k)}<li>{c}</li>{/each}
            </ol>
            <p class="label">What to do</p>
            <ul class="prose-list">
              {#each e.fixes as f, k (k)}<li>{f}</li>{/each}
            </ul>
            {#if e.outside}<p class="outside"><b>Beyond prose-gui:</b> {e.outside}</p>{/if}
          </div>
        </details>
      {/each}
    </div>
  {/each}
</section>

<style>
  .faq {
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    padding: 0.4rem 0.75rem;
    scroll-margin-top: 1rem;
  }
  .faq[open] {
    background: var(--color-background);
  }
  .faq summary {
    cursor: pointer;
    font-weight: 600;
  }
  .body {
    margin-top: 0.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .label {
    margin-top: 0.25rem;
    font-size: 12px;
    font-weight: 600;
    color: var(--color-muted-foreground);
  }
  .outside {
    font-size: 12.5px;
    color: var(--color-muted-foreground);
  }
</style>
