<script lang="ts">
  // Search settings: the preset (PresetPicker), the ten common parameters (in the mockup's order), "Advanced": the
  // threads (all cores by default), the database chunks and co-isolated precursors, and the web app's "All N parameters" dialog
  // (AllParametersDialog), made from the pinned ProSE's parameter list.
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'
  import FdrInput from '$lib/components/FdrInput.svelte'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { Label } from '$lib/components/ui/label'
  import { Switch } from '$lib/components/ui/switch'
  import { searchForm as form } from '$lib/search/form.svelte'
  import { NO_FDR_HINT, searchPlan } from '$lib/search/plan.svelte'
  import { loadCores, machine } from '$lib/search/tool.svelte'
  import { onMount } from 'svelte'
  import { dialogEntries } from '$lib/settings/parameters'
  import AllParametersDialog from './AllParametersDialog.svelte'
  import ChoiceSelect from './ChoiceSelect.svelte'
  import ModificationsField from './ModificationsField.svelte'
  import NumberField from './NumberField.svelte'
  import Help from './Help.svelte'
  import PresetPicker from './PresetPicker.svelte'
  import RangeField from './RangeField.svelte'
  import ToleranceField from './ToleranceField.svelte'

  let dialogOpen = $state(false)
  const count = $derived(dialogEntries([...form.entries.values()]).length)

  // the cores of this computer (the default of the threads)
  onMount(loadCores)
  const cores = $derived(machine.cores)

  // the usual enzymes first, then the others alphabetically
  const COMMON_ENZYMES = [
    'Trypsin/P',
    'Trypsin',
    'Lys-C',
    'Lys-C/P',
    'Arg-C',
    'Asp-N',
    'Glu-C+P',
    'Chymotrypsin',
    'Chymotrypsin/P',
    'unspecific cleavage',
  ]
  const enzymeOptions = $derived.by(() => {
    const valid = form.entry('enzyme')?.validStrings ?? [String(form.value('enzyme'))]
    const common = COMMON_ENZYMES.filter((e) => valid.includes(e))
    const rest = valid.filter((e) => !common.includes(e)).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
    return [...common, ...rest].map((e) => ({ value: e, label: e }))
  })

  // a guidance re-run's changed values are ringed (`form.guided`)
  const guided = (...names: string[]) => (names.some((n) => form.guided?.names.includes(n)) ? 'rounded-md ring-2 ring-amber-400 ring-offset-2 ring-offset-card' : '')
  const lower = $derived(form.value<number>('precursor:mass_tolerance_lower'))
  const upper = $derived(form.value<number>('precursor:mass_tolerance_upper'))

  function setPrecursor(v: number) {
    form.setParam('precursor:mass_tolerance_lower', v)
    form.setParam('precursor:mass_tolerance_upper', v)
  }

  // ranges whose lowest value is above the highest: marked, and the search waits (plan.svelte.ts)
  const fdrClass = '[&>div:first-child]:h-8 [&>div:first-child]:bg-background [&>div:first-child]:shadow-none'

  const chargesInverted = $derived(searchPlan.inverted.some((r) => r.min === 'precursor:min_charge'))
  const lengthInverted = $derived(searchPlan.inverted.some((r) => r.min === 'peptide:min_size'))

  // the one line New search shows of the settings until they are opened: what a preset decides
  const summary = $derived(
    [
      String(form.value('enzyme')),
      `${upper} ${form.value('precursor:mass_tolerance_unit')} precursor`,
      `${form.value('fragment:mass_tolerance')} ${form.value('fragment:mass_tolerance_unit')} fragment`,
      `fixed: ${(form.value<string[]>('modifications:fixed') ?? []).join(', ') || 'none'}`,
    ].join(' · '),
  )
  const modOptions = $derived(form.entry('modifications:variable')?.validStrings)
  const fixedOptions = $derived(form.entry('modifications:fixed')?.validStrings)
</script>

<!-- Basic: the preset (instrument), what was done to the sample (variable modifications) and how strict the results are
(FDR); everything the preset decides is under "Advanced settings", with a one-line summary while it is closed. -->
<Card.Root size="sm" class="gap-3 rounded-lg shadow-none">
  <Card.Header class="flex flex-wrap items-center gap-x-2.5 gap-y-2">
    <Card.Title class="text-[14px] font-semibold">Search settings</Card.Title>
    <PresetPicker />
    <Help topic="setup" />
    <div class="flex-1"></div>
    <Button variant="ghost" size="sm" class="h-7 px-2 text-xs text-muted-foreground" onclick={() => (dialogOpen = true)}>
      All {count} parameters<ChevronRightIcon class="size-3.5" />
    </Button>
  </Card.Header>

  <Card.Content class="grid grid-cols-2 gap-x-4 gap-y-3.5 md:grid-cols-4">
    {#if form.guided && form.guided.lines.length > 0}
      <p class="col-span-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[12.5px] text-amber-900 md:col-span-4 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200" data-testid="guided-changes">
        Changed from “{form.guided.from}”: {form.guided.lines.join('; ')}. Start the search when the rest is as you want it.
        <button type="button" class="ml-1 underline underline-offset-2" onclick={() => (form.guided = null)}>Dismiss</button>
      </p>
    {/if}
    <div class="col-span-2 grid min-w-0 gap-1">
      <span id="variable-mods-label" class="text-xs font-medium">Variable modifications <Help topic="variableMods" /></span>
      <ModificationsField
        labelId="variable-mods-label"
        kind="variable"
        value={form.value<string[]>('modifications:variable') ?? []}
        options={modOptions}
        onChange={(v) => form.setParam('modifications:variable', v)} />
    </div>

    {#if searchPlan.fdrBlocked}
      <!-- without decoys: no FDR (both off and disabled; the values come back with the decoys) -->
      <div class="col-span-2 grid min-w-0 grid-cols-2 content-start gap-x-4 gap-y-1">
        <Label for="psm-fdr" class="text-xs">PSM FDR <Help topic="psmFdr" /></Label>
        <Label for="protein-fdr" class="text-xs">Protein FDR <Help topic="proteinFdr" /></Label>
        <FdrInput id="psm-fdr" off disabled value={0} aria-describedby="no-fdr-hint" class={fdrClass} />
        <FdrInput id="protein-fdr" off disabled value={0} aria-describedby="no-fdr-hint" class={fdrClass} />
        <p id="no-fdr-hint" class="col-span-2 text-xs text-muted-foreground" data-testid="no-fdr-hint">{NO_FDR_HINT}</p>
      </div>
    {:else}
      <div class="grid min-w-0 content-start gap-1">
        <Label for="psm-fdr" class="text-xs">PSM FDR <Help topic="psmFdr" /></Label>
        <FdrInput
          id="psm-fdr"
          class={fdrClass}
          bind:value={() => form.value<number>('FDR:PSM'), (v) => form.setParam('FDR:PSM', v)} />
      </div>
      <div class="grid min-w-0 content-start gap-1">
        <Label for="protein-fdr" class="text-xs">Protein FDR <Help topic="proteinFdr" /></Label>
        <!-- off (0): ProSE applies no protein FDR (the example's setting) -->
        <FdrInput
          id="protein-fdr"
          off
          class={fdrClass}
          bind:value={() => form.value<number>('FDR:protein'), (v) => form.setParam('FDR:protein', v)} />
      </div>
    {/if}

    <div class="col-span-2 flex min-w-0 items-center gap-2 border-t pt-3 md:col-span-4">
      <Button
        variant="ghost"
        size="sm"
        class="-ml-2 h-7 px-2 text-xs"
        aria-expanded={form.showSettings}
        aria-controls="advanced-search-settings"
        data-testid="show-settings"
        onclick={() => (form.showSettings = !form.showSettings)}>
        <ChevronRightIcon class="size-3.5 transition-transform {form.showSettings ? 'rotate-90' : ''}" />Advanced settings
      </Button>
      {#if !form.showSettings}
        <p class="min-w-0 truncate text-xs text-muted-foreground" title={summary} data-testid="settings-summary">
          {summary}{form.modified ? ' · changed from the preset' : ' · from the preset'}
        </p>
      {/if}
    </div>

    {#if form.showSettings}
      <div id="advanced-search-settings" class="col-span-2 grid grid-cols-2 gap-x-4 gap-y-3.5 md:col-span-4 md:grid-cols-4">
    <div class="grid min-w-0 gap-1">
      <Label for="enzyme" class="text-xs">Enzyme <Help topic="enzyme" /></Label>
      <ChoiceSelect id="enzyme" value={String(form.value('enzyme'))} options={enzymeOptions} onChange={(v) => form.setParam('enzyme', v)} />
    </div>
    <div class="grid min-w-0 gap-1">
      <Label for="missed-cleavages" class="text-xs">Missed cleavages <Help topic="missedCleavages" /></Label>
      <NumberField
        id="missed-cleavages"
        kind="int"
        min={0}
        value={form.value<number>('peptide:missed_cleavages')}
        onChange={(v) => form.setParam('peptide:missed_cleavages', v)} />
    </div>
    <div class="grid min-w-0 gap-1 {guided('precursor:mass_tolerance_lower', 'precursor:mass_tolerance_upper', 'precursor:mass_tolerance_unit')}">
      <Label for="precursor-tolerance" class="text-xs">Precursor tolerance <Help topic="precursorTolerance" /></Label>
      <ToleranceField
        id="precursor-tolerance"
        label="Precursor tolerance"
        value={upper}
        unit={String(form.value('precursor:mass_tolerance_unit'))}
        onValue={setPrecursor}
        onUnit={(u) => form.setParam('precursor:mass_tolerance_unit', u)} />
      {#if lower !== upper}
        <p class="text-xs text-muted-foreground">The tolerance is asymmetric (−{lower} / +{upper}). Typing a value sets both sides.</p>
      {/if}
    </div>
    <div class="grid min-w-0 gap-1 {guided('fragment:mass_tolerance', 'fragment:mass_tolerance_unit')}">
      <Label for="fragment-tolerance" class="text-xs">Fragment tolerance <Help topic="fragmentTolerance" /></Label>
      <ToleranceField
        id="fragment-tolerance"
        label="Fragment tolerance"
        value={form.value<number>('fragment:mass_tolerance')}
        unit={String(form.value('fragment:mass_tolerance_unit'))}
        onValue={(v) => form.setParam('fragment:mass_tolerance', v)}
        onUnit={(u) => form.setParam('fragment:mass_tolerance_unit', u)} />
    </div>

    <div class="col-span-2 grid min-w-0 gap-1">
      <span id="fixed-mods-label" class="text-xs font-medium">Fixed modifications <Help topic="fixedMods" /></span>
      <ModificationsField
        labelId="fixed-mods-label"
        kind="fixed"
        value={form.value<string[]>('modifications:fixed') ?? []}
        options={fixedOptions}
        onChange={(v) => form.setParam('modifications:fixed', v)} />
    </div>
    <div class="grid min-w-0 content-start gap-1">
      <span id="charges-label" class="text-xs font-medium">Charges <Help topic="charges" /></span>
      <RangeField
        labelId="charges-label"
        from={form.value<number>('precursor:min_charge')}
        to={form.value<number>('precursor:max_charge')}
        fromLabel="Lowest precursor charge"
        toLabel="Highest precursor charge"
        min={form.entry('precursor:min_charge')?.min ?? 1}
        max={form.entry('precursor:max_charge')?.max}
        invalid={chargesInverted}
        describedBy="charges-inverted"
        onFrom={(v) => form.setParam('precursor:min_charge', v)}
        onTo={(v) => form.setParam('precursor:max_charge', v)} />
      {#if chargesInverted}
        <p id="charges-inverted" class="text-xs text-destructive">The lowest charge is above the highest.</p>
      {/if}
    </div>
    <div class="grid min-w-0 content-start gap-1">
      <span id="length-label" class="text-xs font-medium">Peptide length <Help topic="length" /></span>
      <RangeField
        labelId="length-label"
        from={form.value<number>('peptide:min_size')}
        to={form.value<number>('peptide:max_size')}
        fromLabel="Shortest peptide (residues)"
        toLabel="Longest peptide (residues)"
        min={1}
        invalid={lengthInverted}
        describedBy="length-inverted"
        onFrom={(v) => form.setParam('peptide:min_size', v)}
        onTo={(v) => form.setParam('peptide:max_size', v)} />
      {#if lengthInverted}
        <p id="length-inverted" class="text-xs text-destructive">The shortest length is above the longest.</p>
      {/if}
    </div>

      <div class="col-span-2 grid grid-cols-2 gap-x-4 gap-y-3.5 border-t pt-3.5 md:col-span-4 md:grid-cols-4" data-testid="advanced-settings">
        <div class="grid min-w-0 content-start gap-1">
          <Label for="threads" class="text-xs">Threads</Label>
          <NumberField
            id="threads"
            kind="int"
            min={1}
            max={1024}
            placeholder={cores ? `all (${cores})` : 'all'}
            value={form.threads ?? undefined}
            onChange={(v) => (form.threads = v)}
            onClear={() => (form.threads = null)} />
          <p class="text-xs text-muted-foreground">Leave empty to use all cores.</p>
        </div>
        <div class="grid min-w-0 content-start gap-1">
          <Label for="chunk-size" class="text-xs">Database chunk size</Label>
          <NumberField
            id="chunk-size"
            kind="int"
            min={0}
            value={form.value<number>('database:chunk_size')}
            onChange={(v) => form.setParam('database:chunk_size', v)} />
          <p class="text-xs text-muted-foreground">How many proteins go into each part of the fragment index. 0 indexes the whole database at once.</p>
        </div>
        <div class="col-span-2 flex items-start gap-3">
          <Switch
            id="chimeric"
            class="mt-0.5"
            checked={form.value('chimeric:enabled') === true && !searchPlan.chimericBlocked}
            disabled={searchPlan.chimericBlocked}
            onCheckedChange={(c) => form.setParam('chimeric:enabled', c)}
            aria-describedby="chimeric-hint" />
          <div class="min-w-0">
            <Label for="chimeric" class="text-xs">Co-isolated precursors</Label>
            <p id="chimeric-hint" class="mt-0.5 text-xs text-muted-foreground">
              Also identifies the other precursors in each MS2 spectrum's isolation window, found in its survey scan.
              {#if searchPlan.chimericBlocked}
                <span class="text-foreground">Set the database chunk size to 0 to use it.</span>
              {/if}
            </p>
          </div>
        </div>
      </div>
      </div>
    {/if}
  </Card.Content>
</Card.Root>

<AllParametersDialog bind:open={dialogOpen} />
