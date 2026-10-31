<script lang="ts">
  // Help › Troubleshooting: what the checks of the app mean and cannot see, then every FAQ entry (`settings/faq.ts`)
  // by its group, each a <details> with the entry's id, so that "What to do ›" beside a check opens it (`target`).
  // A search box filters the entries by their text.
  import { FAQ, FAQ_GROUPS, type FaqEntry } from '$lib/settings/faq'
  import { tick } from 'svelte'
  import { revealSection } from './reveal'

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
    // (revealSection opens the entry also when it was closed by hand after an earlier link)
    void tick().then(() => revealSection(id, true))
  }
</script>

<section id="troubleshooting-intro" aria-labelledby="troubleshooting-h">
  <h2 id="troubleshooting-h">Troubleshooting</h2>
  <p>
    Search went wrong? Start with
    <button type="button" class="jump" onclick={() => go('faq-few-ids')}>few or no identifications</button>,
    <button type="button" class="jump" onclick={() => go('faq-settings-rejected')}>the search will not start</button>, or
    <button type="button" class="jump" onclick={() => go('faq-decoys-fdr')}>the FDR looks wrong</button>. The “What to do ›” beside a
    message of the app opens its entry here. A PSM (peptide-spectrum match) is the best-scoring peptide of a spectrum; a
    q-value is the lowest FDR (false discovery rate) at which it would still be reported.
  </p>
  <h3 id="troubleshooting-checks">What the checks mean, and what they cannot see</h3>
  <ul class="prose-list">
    <li><b>Blocking</b> (named in the line beside Start, which stays unavailable): the search cannot start until it is fixed. Start
      also waits while files are added, the database is counted and the spectra of mzML files are read.</li>
    <li>
      Some red flags (profile spectra, no MS2 spectra, DIA data) offer <b>Search anyway</b>: it searches the files as they are, changes
      nothing in them, and is remembered on this computer for this version of each file (its size and modification time): a file that
      changes is checked again; the notice “Searched anyway: …” has <b>Ask again</b> to take it back. It is recorded with the search, so Re-run does not ask again for unchanged files, and the methods text
      names profile spectra and missing MS2 spectra when ProSE confirmed them. A database with far more or fewer decoys than targets is
      no red flag: ProSE refuses it, so Start stays blocked until you click <b>Generate decoys</b>.
    </li>
    <li><b>Notices</b> (advice in amber, information in grey) do not stop the search, and they are kept with it: the Overview of the
      result lists them under Checks of the search, beside what the cards found after it.</li>
    <li>
      Before Start, the app reads the flags of up to the first 1,000 MS2 spectra (within the first 64 MiB) of mzML files: whether
      they are flagged centroid or profile, their charges, activation and isolation windows. It does not look at the peaks, so a
      mislabelled file passes. Thermo .raw, Bruker .d and mzPeak files are not inspected before Start; after the search ProSE
      reports for them only no MS2 spectra, profile spectra and charges outside the range, not the DIA, missing-charge or
      analyzer checks.
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
    <h3 id="faq-group-{g.id}" class="group-title">{g.title}</h3>
    <div class="faq-list">
      {#each g.entries as e (e.id)}
        <details id={e.id} class="faq" open={opened === e.id || words.length > 0}>
          <summary>{e.question}</summary>
          <div class="body">
            <p>{e.symptoms}</p>
            <p class="label">Possible causes, the usual ones first</p>
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
  /* flat: each group is one list with hairlines between the questions, not a box per question */
  .group-title {
    margin-top: 1.25rem;
    font-size: 12px;
    color: var(--color-muted-foreground);
  }
  .faq-list {
    border-top: 1px solid var(--color-border);
  }
  .faq {
    border-bottom: 1px solid var(--color-border);
    scroll-margin-top: 1rem;
  }
  .faq summary {
    cursor: pointer;
    font-weight: 500;
    padding: 0.4rem 0.25rem;
    border-radius: 0.25rem;
  }
  .faq summary:hover {
    background: var(--color-muted);
  }
  .faq summary:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: -2px;
  }
  .body {
    margin: 0 0 0.75rem 1rem;
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
