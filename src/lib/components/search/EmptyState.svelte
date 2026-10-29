<script lang="ts">
  // The Spectra card before any file is added: add or drop mzML files, or try the example. Files are
  // chosen in the system's dialog (their paths; nothing is copied).
  import StepNumber from './StepNumber.svelte'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { addAnyFiles } from '$lib/design/sdrf-session.svelte'
  import { chooseFiles } from '$lib/desktop'
  import { searchForm as form } from '$lib/search/form.svelte'
  import { openHelp } from '$lib/help-link.svelte'
  import NoticeList from './NoticeList.svelte'
  import SdrfPanel from './SdrfPanel.svelte'

  let { dragging = false }: { dragging?: boolean } = $props()

  async function add() {
    const paths = await chooseFiles('spectra')
    if (paths.length > 0) await addAnyFiles(paths)
  }
</script>

<Card.Root size="sm" class="gap-3">
  <Card.Header class="flex items-center gap-2.5">
    <StepNumber n={1} />
    <Card.Title class="text-[14px] font-semibold">Spectra</Card.Title>
  </Card.Header>
  <Card.Content class="flex flex-col gap-3">
    <div
      class="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-md border border-dashed px-4 py-4 transition-colors {dragging
        ? 'border-primary/60 bg-primary/5'
        : 'border-border'}">
      <div class="min-w-0 flex-1">
        <p class="font-medium">Drop spectrum files here, or add them</p>
        <p class="text-xs text-muted-foreground">
          Spectra (mzML, mzPeak, Thermo .raw, Bruker .d: drop the folder, or choose its analysis.tdf), and if you have them a
          FASTA database and an SDRF or design.tsv with the experimental design, all in one go. An SDRF adds the files it
          names. <button type="button" class="underline underline-offset-2" onclick={() => openHelp('formats')}>Which files?</button>
        </p>
      </div>
      <div class="flex items-center gap-2">
        <Button size="sm" disabled={form.adding > 0} onclick={add}>Add files</Button>
        <Button variant="outline" size="sm" disabled={form.busy} onclick={() => form.loadExample()}>
          {form.exampleLoading ? 'Loading the example…' : 'Try the example'}
        </Button>
      </div>
    </div>
    <SdrfPanel />
    {#if form.removed}
      {@const n = form.removed.files.length}
      <p class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role="status" data-testid="removed-note">
        {n > 0 ? `Removed ${n} ${n === 1 ? 'file' : 'files'}${form.removed.database ? ' and the database' : ''}.` : 'Removed the database.'}
        <Button variant="outline" size="sm" class="h-6 px-2 text-xs" disabled={form.busy} onclick={() => form.undoRemove()}>Undo</Button>
      </p>
    {/if}
    <p class="text-xs text-muted-foreground">
      The example is a small E. coli run with 139 spectra. It is searched twice, as two replicates, against the E. coli
      proteome. The run is too small for a PSM FDR of 1 % (its PSMs reach 1.2 % at best), so its PSM FDR is 2 %, and too
      small for a protein FDR, so its proteins are listed without one. It also has too few PSMs for Percolator's full
      model, which the results note.
    </p>
    <NoticeList items={form.notices.map((message, k) => ({ message, onDismiss: () => form.notices.splice(k, 1) }))} />
  </Card.Content>
</Card.Root>
