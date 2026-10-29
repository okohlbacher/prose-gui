<script lang="ts">
  // The one filter row of a level: text, the q-value cutoff (tightening the search's only), and on
  // proteins the minimum peptides and "found in"; contaminants and decoys as chips; "n of total".
  import FdrInput from '$lib/components/FdrInput.svelte'
  import ChoiceSelect from '$lib/components/search/ChoiceSelect.svelte'
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu'
  import * as Popover from '$lib/components/ui/popover'
  import * as Tooltip from '$lib/components/ui/tooltip'
  import { formatPercent, formatQ } from '$lib/format/fdr'
  import { parseSdrfTable, sdrfFilterOptions } from '$lib/design/sdrf-table'
  import { formatCount, parseAccession } from '$lib/results/display'
  import { psmValue, RANGE_KEYS, targetDecoyOf, type RangeKey } from '$lib/results/filters'
  import { psmFdrOff } from '$lib/results/overview'
  import type { LevelState, ResultsView } from '$lib/results/view.svelte'
  import { cn } from '$lib/utils'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import { untrack } from 'svelte'
  import SearchIcon from '@lucide/svelte/icons/search'
  import XIcon from '@lucide/svelte/icons/x'

  // psmFdrApplied: false when the search applied the PSM FDR to none of its PSMs (no decoy PSM): no q-values to filter by
  let {
    view,
    level,
    proteinFdrApplied,
    psmFdrApplied = true,
  }: { view: ResultsView; level: LevelState; proteinFdrApplied: boolean; psmFdrApplied?: boolean } = $props()

  const names = {
    proteins: { filter: 'Filter proteins', placeholder: 'Accession, gene, name, peptide…', q: 'Protein FDR' },
    peptides: { filter: 'Filter peptides', placeholder: 'Sequence, modification, accession…', q: 'Best PSM q-value' },
    psms: { filter: 'Filter PSMs', placeholder: 'Sequence, modification, accession…', q: 'PSM FDR' },
  } as const
  const name = $derived(names[level.level])
  const cutoff = $derived(level.level === 'proteins' ? view.result.proteinFdr : view.result.psmFdr)
  const qId = $derived(`q-filter-${level.level}`)

  /** The peptide (ProForma) that the PSM table is restricted to ("All n in the PSM table"). */
  const peptide = $derived.by(() => {
    const k = level.filters.peptideFilter
    return k === undefined || level.level !== 'psms' ? null : (view.model.tables.peptides.proforma[k] ?? null)
  })

  /** The protein the table is restricted to ("Open in PSM table"), as its accession shows in the tables. */
  const protein = $derived.by(() => {
    const p = level.filters.proteinFilter
    if (p === undefined || level.level === 'proteins') return null
    const accession = view.model.tables.proteins.accession[p]
    return accession === undefined ? null : { id: parseAccession(accession).id, accession }
  })

  // typing filters after a short pause, so that 150,000 PSMs are not filtered on every key
  // the bar is made anew for each level (Results keys it), so the first value is the one
  // svelte-ignore state_referenced_locally
  let draft = $state(level.filters.text)
  let timer: ReturnType<typeof setTimeout> | undefined
  function type(event: Event & { currentTarget: HTMLInputElement }) {
    draft = event.currentTarget.value
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      level.filters.text = draft
    }, 150)
  }
  function clearText() {
    clearTimeout(timer)
    timer = undefined
    draft = ''
    level.filters.text = ''
  }
  // a text the view set itself (opening a PSM that the text hides clears it): the field shows it
  $effect(() => {
    const text = level.filters.text
    untrack(() => {
      if (timer === undefined && draft !== text) draft = text
    })
  })

  const peptideChoices = [
    { value: '0', label: 'Any number of peptides' },
    { value: '2', label: '≥ 2 peptides' },
    { value: '3', label: '≥ 3 peptides' },
    { value: '5', label: '≥ 5 peptides' },
  ]
  /** The most biological samples of a condition: "found in ≥ n" offers 2 … that. */
  const maxReplicates = $derived(Math.max(0, ...view.model.conditionColumns.map((c) => c.samples.length)))
  const foundChoices = $derived([
    { value: '0', label: 'Found in any sample' },
    ...Array.from({ length: Math.max(0, maxReplicates - 1) }, (_, i) => ({
      value: String(i + 2),
      label: `Found in ≥ ${i + 2} replicates of a condition`,
    })),
  ])

  /** The SDRF columns the result's files can be filtered by (a result started with an SDRF). */
  const sdrfOptions = $derived(
    view.result.sdrf ? sdrfFilterOptions(parseSdrfTable(view.result.sdrf.text), view.result.design.rows.map((r) => r.fileName)) : [],
  )

  // PSMs: the charges the result has, the range filters, and the targets and decoys the filters keep
  const charges = $derived.by(() => {
    if (level.level !== 'psms') return []
    const seen = new Set<number>()
    for (const z of view.model.tables.psms.charge) seen.add(z)
    return [...seen].sort((a, b) => a - b)
  })
  function toggleCharge(z: number) {
    const now = level.filters.charges ?? []
    level.filters.charges = now.includes(z) ? now.filter((c) => c !== z) : [...now, z]
  }
  /** A range on `key`, starting at the values of the PSMs (rounded outwards). */
  function addRange(key: RangeKey) {
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < view.model.tables.psms.count; i++) {
      const v = psmValue(view.model, key, i)
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    if (!Number.isFinite(lo)) return
    const others = (level.filters.ranges ?? []).filter((r) => r.key !== key)
    level.filters.ranges = [...others, { key, min: Math.floor(lo * 100) / 100, max: Math.ceil(hi * 100) / 100 }]
  }
  // an emptied field keeps its bound (Number('') would be 0); From above To swaps them, as the user meant the range
  function setRange(key: RangeKey, side: 'min' | 'max', text: string) {
    const value = Number(text)
    if (text.trim() === '' || !Number.isFinite(value)) return
    level.filters.ranges = (level.filters.ranges ?? []).map((r) => {
      if (r.key !== key) return r
      const next = { ...r, [side]: value }
      return next.min <= next.max ? next : { ...next, min: next.max, max: next.min }
    })
  }
  const narrowed = $derived(
    level.level === 'psms' &&
      ((level.filters.charges?.length ?? 0) > 0 || (level.filters.ranges?.length ?? 0) > 0 || level.filters.text !== '' || level.filters.sdrf !== undefined),
  )
  // (a search without decoys, or whose PSM FDR was skipped everywhere, has no decoys to estimate from)
  const td = $derived(narrowed && psmFdrApplied && !psmFdrOff(view.result.outcome.summary) ? targetDecoyOf(view.model, level.filters) : null)

  const chip =
    'inline-flex h-7 items-center gap-1.5 rounded-full border bg-background pr-2 pl-3 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
  const selectLike =
    'inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13px] whitespace-nowrap hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none'
</script>

<div class="flex flex-wrap items-center gap-2" data-testid="filter-bar">
  <label class="relative flex h-8 max-w-80 min-w-[18.5rem] grow basis-[18.5rem] items-center">
    <span class="sr-only">{name.filter}</span>
    <SearchIcon class="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" aria-hidden="true" />
    <input
      type="search"
      class="h-8 w-full rounded-md border bg-background pr-7 pl-8 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      placeholder={name.placeholder}
      aria-label={name.filter}
      autocomplete="off"
      spellcheck="false"
      value={draft}
      oninput={type}
      onkeydown={(e) => e.key === 'Escape' && draft && (e.preventDefault(), clearText())} />
  </label>

  {#if (level.level === 'proteins' && !proteinFdrApplied) || (level.level !== 'proteins' && !psmFdrApplied)}
    <!-- aria-disabled, not disabled: it stays focusable, so that the tooltip says why -->
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <button {...props} type="button" class={cn(selectLike, 'cursor-not-allowed text-muted-foreground opacity-60')} aria-disabled="true"
            >{level.level === 'proteins' ? 'Protein FDR' : 'PSM FDR'}: not available</button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content class="max-w-xs" role="tooltip"
        >{level.level === 'proteins'
          ? 'This search did not apply a protein FDR, so the proteins have no q-values to filter by.'
          : 'This search did not apply the PSM FDR (no PSM matched a decoy), so the PSMs have no q-values to filter by.'}</Tooltip.Content>
    </Tooltip.Root>
  {:else}
    <Popover.Root>
      <Popover.Trigger class={selectLike}>
        {name.q} ≤ {formatPercent(level.filters.maxQ)}
        <span class="text-muted-foreground">({formatQ(level.filters.maxQ)})</span>
        <ChevronDown class="size-3.5 text-muted-foreground" aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Content class="w-72" align="start">
        <div class="grid gap-2">
          <label for={qId} class="text-xs font-medium">{name.q}</label>
          <FdrInput id={qId} bind:value={level.filters.maxQ} max={cutoff} />
          <p class="text-xs text-muted-foreground">
            The search's cutoff is {formatPercent(cutoff)} ({formatQ(cutoff)}). You can tighten it here. A looser cutoff
            needs a new search.
          </p>
        </div>
      </Popover.Content>
    </Popover.Root>
  {/if}

  {#if level.level === 'proteins'}
    <ChoiceSelect
      class="w-auto"
      ariaLabel="Minimum peptides"
      value={String(level.filters.minPeptides)}
      options={peptideChoices}
      onChange={(v) => (level.filters.minPeptides = Number(v))} />
    {#if maxReplicates >= 2}
      <ChoiceSelect
        class="w-auto"
        ariaLabel="Found in replicates of a condition"
        value={String(level.filters.minReplicatesInCondition)}
        options={foundChoices}
        onChange={(v) => (level.filters.minReplicatesInCondition = Number(v))} />
    {/if}
  {/if}

  {#if protein}
    <button type="button" class={chip} title={protein.accession} onclick={() => (level.filters.proteinFilter = undefined)}>
      Protein: {protein.id}<XIcon class="size-3" aria-hidden="true" /><span class="sr-only">(remove the filter)</span>
    </button>
  {/if}
  {#if peptide}
    <button type="button" class={chip} title={peptide} onclick={() => (level.filters.peptideFilter = undefined)}>
      <span class="max-w-[16rem] truncate">Peptide: {peptide}</span><XIcon class="size-3 shrink-0" aria-hidden="true" /><span class="sr-only">(remove the filter)</span>
    </button>
  {/if}
  {#if level.filters.sdrf}
    {@const f = level.filters.sdrf}
    <button type="button" class={chip} title="{f.files.length} of {view.result.design.rows.length} files" data-testid="sdrf-filter-chip" onclick={() => (level.filters.sdrf = undefined)}>
      <span class="max-w-[18rem] truncate">{f.column.replace(/^(factor value|characteristics)\[(.*)\]$/i, '$2')}: {f.value}</span><XIcon class="size-3 shrink-0" aria-hidden="true" /><span class="sr-only">(remove the filter)</span>
    </button>
  {/if}
  {#if charges.length > 1}
    <div class="flex items-center gap-1" role="group" aria-label="Precursor charges">
      <span class="text-xs text-muted-foreground">z</span>
      {#each charges as z (z)}
        {@const on = level.filters.charges?.includes(z) ?? false}
        <button
          type="button"
          aria-pressed={on}
          class="h-7 min-w-7 rounded-full border px-2 text-xs tabular-nums {on ? 'border-foreground bg-foreground text-background' : 'bg-background text-muted-foreground hover:text-foreground'}"
          onclick={() => toggleCharge(z)}>{z}+</button>
      {/each}
    </div>
  {/if}
  {#each level.filters.ranges ?? [] as r (r.key)}
    <Popover.Root>
      <Popover.Trigger class={chip} data-testid="range-chip">{RANGE_KEYS[r.key]}: {r.min} – {r.max}</Popover.Trigger>
      <Popover.Content class="w-72" align="start">
        <div class="grid grid-cols-2 gap-2 text-xs">
          <p class="col-span-2 font-medium">{RANGE_KEYS[r.key]}</p>
          <label class="grid gap-1">From<input type="number" step="any" class="h-8 rounded-md border bg-background px-2" value={r.min} onchange={(e) => setRange(r.key, 'min', e.currentTarget.value)} /></label>
          <label class="grid gap-1">To<input type="number" step="any" class="h-8 rounded-md border bg-background px-2" value={r.max} onchange={(e) => setRange(r.key, 'max', e.currentTarget.value)} /></label>
          <button type="button" class="col-span-2 justify-self-start text-destructive underline underline-offset-2" onclick={() => (level.filters.ranges = (level.filters.ranges ?? []).filter((x) => x.key !== r.key))}>Remove this filter</button>
        </div>
      </Popover.Content>
    </Popover.Root>
  {/each}
  {#if level.filters.hideContaminants}
    <button type="button" class={chip} onclick={() => (level.filters.hideContaminants = false)}>
      Contaminants hidden<XIcon class="size-3" aria-hidden="true" /><span class="sr-only">(show them)</span>
    </button>
  {/if}
  {#if level.filters.showDecoys}
    <button type="button" class={chip} onclick={() => (level.filters.showDecoys = false)}>
      Decoys shown<XIcon class="size-3" aria-hidden="true" /><span class="sr-only">(hide them)</span>
    </button>
  {/if}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      class="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none aria-expanded:bg-muted">
      + Filter
    </DropdownMenu.Trigger>
    <DropdownMenu.Content class="w-auto min-w-48">
      <DropdownMenu.CheckboxItem bind:checked={level.filters.hideContaminants}>Hide contaminants</DropdownMenu.CheckboxItem>
      <DropdownMenu.CheckboxItem bind:checked={level.filters.showDecoys}>Show decoys</DropdownMenu.CheckboxItem>
      {#if level.level === 'psms'}
        <DropdownMenu.Separator />
        <DropdownMenu.Label class="text-xs text-muted-foreground">Range</DropdownMenu.Label>
        {#each Object.entries(RANGE_KEYS) as [key, label] (key)}
          <DropdownMenu.Item onSelect={() => addRange(key as RangeKey)}>{label}</DropdownMenu.Item>
        {/each}
      {/if}
      {#if sdrfOptions.length > 0}
        <DropdownMenu.Separator />
        <DropdownMenu.Label class="text-xs text-muted-foreground">SDRF</DropdownMenu.Label>
        {#each sdrfOptions as option (option.column)}
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger>{option.column}</DropdownMenu.SubTrigger>
            <DropdownMenu.SubContent>
              {#each option.values as v (v.value)}
                <DropdownMenu.Item onSelect={() => (level.filters.sdrf = { column: option.column, value: v.value, files: v.files })}
                  >{v.value} <span class="ml-auto pl-3 text-muted-foreground">{v.files.length} {v.files.length === 1 ? 'file' : 'files'}</span></DropdownMenu.Item>
              {/each}
            </DropdownMenu.SubContent>
          </DropdownMenu.Sub>
        {/each}
      {/if}
    </DropdownMenu.Content>
  </DropdownMenu.Root>

  <span class="ml-auto text-xs text-muted-foreground tabular-nums" data-testid="row-count" aria-live="polite"
    >{formatCount(level.rows.length)} of {formatCount(level.total)}{#if td}<span
        class="ml-2"
        data-testid="subset-fdr"
        title="Decoy and target PSMs that these filters keep. Only PSMs that passed the search's FDR are stored, so this is an estimate within the passing PSMs, not a new FDR."
        > · targets {formatCount(td.targets)} · decoys {formatCount(td.decoys)} · est. FDR ≈ {td.targets > 0 ? ((td.decoys / td.targets) * 100).toFixed(1) : '–'} % (within the passing set)</span
      >{/if}</span>
</div>
