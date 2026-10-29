<script lang="ts">
  import StepNumber from './StepNumber.svelte'
  import { fastaLine } from '$lib/search/database'
  // The protein database: the FASTA file, decoys (ProSE's `decoys`) and the cRAP contaminants. Under it, why
  // ProSE cannot search the file (the search does not start), and what ProSE may mishandle in it (notices).
  import * as Card from '$lib/components/ui/card'
  import { Label } from '$lib/components/ui/label'
  import { chooseFiles, downloadedProteomes, downloadProteome, findProteomes, isDesktop, type ProteomeHit } from '$lib/desktop'
  import { ORGANISMS, proteomeLabel, rememberProteome } from '$lib/settings/organisms'
  import { onMount } from 'svelte'
  import Help from './Help.svelte'
  import { CRAP_PROTEINS, searchForm as form } from '$lib/search/form.svelte'
  import { choiceLabel } from '$lib/settings/labels'
  import ChoiceSelect from './ChoiceSelect.svelte'
  import NoticeList from './NoticeList.svelte'

  async function choose() {
    const [path] = await chooseFiles('database')
    if (path !== undefined) await form.setDatabase(path)
  }

  const decoyOptions = $derived(
    (form.entry('decoys')?.validStrings ?? ['auto', 'generate', 'ignore']).map((v) => ({
      value: v,
      label: choiceLabel('decoys', v),
    })),
  )

  const proteins = $derived(form.database?.proteins ?? null)

  // a database without a FASTA at hand: the organism's reference proteome from UniProt (the app's databases folder)
  let organism = $state(ORGANISMS[0].id)
  let otherId = $state('')
  let reviewed = $state(true)
  let downloading = $state(false)
  let downloadError = $state<string | null>(null)
  // the proteomes downloaded before are marked: choosing one takes the file at once
  let downloaded = $state<string[]>([])
  onMount(() => {
    if (isDesktop()) void downloadedProteomes().then((names) => (downloaded = names)).catch(() => {})
  })
  const has = (id: string) => downloaded.some((n) => n.toUpperCase().startsWith(id))
  const organismOptions = $derived([
    ...ORGANISMS.map((o) => ({ value: o.id, label: `${o.name} · ${o.id}${has(o.id) ? ' · downloaded' : ''}` })),
    { value: 'other', label: 'Other organism: search by name (or a UniProt id)…' },
  ])

  // another organism: its name looked up in NCBI Taxonomy, the UniProt proteomes of what it finds to choose from
  let query = $state('')
  let searching = $state(false)
  let hits = $state<ProteomeHit[] | null>(null)
  async function search() {
    downloadError = null
    const q = query.trim()
    if (/^UP\d{9}$/i.test(q)) {
      otherId = q.toUpperCase()
      hits = null
      return
    }
    searching = true
    try {
      hits = await findProteomes(q)
      otherId = hits[0]?.upid ?? ''
    } catch (e) {
      downloadError = String((e as Error)?.message ?? e)
    } finally {
      searching = false
    }
  }
  const hitLabel = (h: ProteomeHit) =>
    `${h.organism}${h.strain ? ` (${h.strain})` : ''} · ${h.upid} · ${h.proteins.toLocaleString('en')} proteins${h.reference ? ' · reference' : ''}`
  // the organism of a downloaded proteome, beside its file name (which names only the UniProt proteome)
  const organismOfFile = $derived(form.database ? proteomeLabel(form.database.file.name) : null)
  async function download() {
    downloadError = null
    downloading = true
    try {
      const id = organism === 'other' ? otherId.trim().toUpperCase() : organism
      const hit = hits?.find((h) => h.upid === id)
      if (hit) rememberProteome(id, `${hit.organism}${hit.strain ? ` (${hit.strain})` : ''}`)
      const before = form.database
      const path = await downloadProteome(id, reviewed)
      // (a FASTA chosen while it downloaded stays chosen)
      if (form.database === before) await form.setDatabase(path)
      downloaded = await downloadedProteomes().catch(() => downloaded)
    } catch (e) {
      downloadError = String((e as Error)?.message ?? e)
    } finally {
      downloading = false
    }
  }
</script>

<Card.Root size="sm" class="gap-3">
  <Card.Header class="flex items-center gap-2">
    <StepNumber n={2} />
    <Card.Title class="text-[14px] font-semibold">Protein database</Card.Title>
  </Card.Header>
  <Card.Content class="grid gap-x-4 gap-y-3.5 md:grid-cols-[2fr_1fr_1fr]">
    <div class="grid min-w-0 gap-1">
      <Label for="fasta-file" class="text-xs">FASTA <Help topic="database" /></Label>
      <button
        id="fasta-file"
        type="button"
        aria-describedby="fasta-chosen"
        class="flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-background px-2.5 text-left dark:bg-input/30 transition-[color,box-shadow] outline-none hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        title={form.database?.file.path}
        onclick={choose}>
        {#if form.database}
          <span id="fasta-chosen" class="min-w-0 truncate"
            >{#if organismOfFile}<span class="text-[13px]">{organismOfFile}</span><span class="ml-2 font-mono text-[11.5px] text-muted-foreground">{form.database.file.name}</span
              >{:else}<span class="font-mono text-[12.5px]">{form.database.file.name}</span>{/if}</span>
          {#if form.database.error}
            <span class="ml-auto shrink-0 text-xs text-destructive" data-testid="fasta-proteins" title={form.database.error}>cannot be read</span>
          {:else if form.database.problem}
            <span class="ml-auto shrink-0 text-xs text-destructive" data-testid="fasta-proteins" title={form.database.problem}>cannot be searched</span>
          {:else}
            <span class="ml-auto shrink-0 text-xs text-muted-foreground" data-testid="fasta-proteins">
              {proteins === null ? 'counting…' : `${proteins.toLocaleString('en-US')} proteins`}
            </span>
          {/if}
        {:else}
          <span id="fasta-chosen" class="text-muted-foreground">Choose a FASTA file…</span>
        {/if}
      </button>
    </div>
    <div class="grid min-w-0 gap-1">
      <Label for="decoys" class="text-xs">Decoys <Help topic="decoys" /></Label>
      <ChoiceSelect
        id="decoys"
        value={String(form.value('decoys') ?? 'auto')}
        options={decoyOptions}
        onChange={(v) => form.setParam('decoys', v)} />
    </div>
    <div class="grid min-w-0 gap-1">
      <Label for="contaminants" class="text-xs">Contaminants <Help topic="contaminants" /></Label>
      <ChoiceSelect
        id="contaminants"
        value={form.contaminants ? 'crap' : 'none'}
        options={[
          { value: 'crap', label: `Add cRAP (${CRAP_PROTEINS} common contaminants)` },
          { value: 'none', label: 'None' },
        ]}
        onChange={(v) => (form.contaminants = v === 'crap')} />
    </div>
    {#if form.database?.summary && form.database.proteins}
      <p class="truncate text-xs text-muted-foreground md:col-span-3" data-testid="fasta-summary" title={fastaLine(form.database.summary, form.database.proteins)}>
        {fastaLine(form.database.summary, form.database.proteins)}
      </p>
    {/if}
    <div class="flex flex-wrap items-center gap-2 text-xs md:col-span-3" data-testid="proteome-download">
      <span class="text-muted-foreground">{form.database ? 'Or download' : 'No FASTA? Download'} the reference proteome from UniProt:</span>
      <div class="w-72"><ChoiceSelect id="organism" value={organism} options={organismOptions} onChange={(v) => (organism = v)} /></div>
      {#if organism === 'other'}
        <form class="flex items-center gap-1.5" onsubmit={(e) => (e.preventDefault(), search())}>
          <input
            class="h-8 w-56 rounded-md border border-input bg-background px-2 text-[12.5px]"
            placeholder="Organism name, e.g. Chlamydomonas"
            aria-label="Organism name (NCBI Taxonomy), or a UniProt proteome id"
            bind:value={query} />
          <button type="submit" class="h-8 rounded-md border px-3 hover:bg-muted disabled:opacity-50" disabled={searching || query.trim().length < 3}
            >{searching ? 'Searching…' : 'Search'}</button>
        </form>
      {/if}
      <label class="flex items-center gap-1.5" title="Swiss-Prot: manually reviewed entries only. Smaller and faster; leave it off for organisms with few reviewed proteins.">
        <input type="checkbox" bind:checked={reviewed} /> Reviewed entries only
      </label>
      <button
        type="button"
        class="h-8 rounded-md border px-3 hover:bg-muted disabled:opacity-50"
        disabled={downloading || (organism === 'other' && !/^UP\d{9}$/i.test(otherId.trim()))}
        onclick={download}>{downloading ? 'Downloading…' : 'Download'}</button>
      {#if organism === 'other' && hits}
        <div class="w-full" data-testid="proteome-hits">
          {#if hits.length === 0}
            <p class="text-muted-foreground">NCBI Taxonomy knows no organism of that name with a UniProt proteome. Try the Latin name, or the genus alone.</p>
          {:else}
            <p class="mb-1 text-muted-foreground">Proteomes of the organisms NCBI Taxonomy finds (reference proteomes first); choose one, then Download:</p>
            <div class="grid gap-0.5" role="radiogroup" aria-label="Proteomes found">
              {#each hits as h (h.upid)}
                <label class="flex items-center gap-2">
                  <input type="radio" name="proteome-hit" value={h.upid} bind:group={otherId} />
                  <span>{hitLabel(h)}{has(h.upid) ? ' · downloaded' : ''}</span>
                </label>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
      {#if downloadError}<p class="w-full text-destructive" role="alert">{downloadError}</p>{/if}
    </div>
    {#if form.database?.problem || (form.database?.warnings.length ?? 0) > 0}
      <div class="flex flex-col gap-2 md:col-span-3">
        {#if form.database?.problem}
          <p class="text-[12.5px] text-destructive" data-testid="fasta-problem">{form.database.problem} Choose another FASTA file.</p>
        {/if}
        <NoticeList items={(form.database?.warnings ?? []).map((message) => ({ message }))} />
      </div>
    {/if}
  </Card.Content>
</Card.Root>
