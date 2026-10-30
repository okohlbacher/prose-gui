<script lang="ts">
  // New search (mockup 1): spectra with the experimental design, the protein database, the search
  // settings and rescoring (the numbered steps 1 to 4), with a sticky footer to start the search. Spectra, a FASTA and an
  // SDRF or design.tsv can be dropped anywhere on the window (from the file manager: their paths, desktop.ts).
  import CheckNotices from '$lib/components/search/CheckNotices.svelte'
  import DatabaseCard from '$lib/components/search/DatabaseCard.svelte'
  import DesignTable from '$lib/components/search/DesignTable.svelte'
  import EmptyState from '$lib/components/search/EmptyState.svelte'
  import RescoringCard from '$lib/components/search/RescoringCard.svelte'
  import SearchFooter from '$lib/components/search/SearchFooter.svelte'
  import SettingsCard from '$lib/components/search/SettingsCard.svelte'
  import { Button } from '$lib/components/ui/button'
  import { addAnyFiles } from '$lib/design/sdrf-session.svelte'
  import { onFileDrop } from '$lib/desktop'
  import { searchForm as form } from '$lib/search/form.svelte'
  import { openProject, project, saveProject } from '$lib/project/project.svelte'
  import { errorText } from '$lib/desktop'

  /** What went wrong with the last Open or Save of a project. */
  let projectError = $state<string | null>(null)

  /** Open Project… and Save Project… (also File › Open Project, Save Project in the desktop app). */
  async function projectAction(action: () => Promise<unknown>, what: string) {
    projectError = null
    try {
      await action()
    } catch (e) {
      projectError = `${what}: ${errorText(e)}`
    }
  }

  let dragging = $state(false)

  /** "a", "a and b", "a, b and c" */
  const listed = (items: string[]) => (items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`)

  // Start over's tooltip names the example's own settings that go back to the preset's
  const startOverTitle = $derived.by(() => {
    const back = form.exampleSettingsInForce
    if (back.length === 0) return 'Removes the spectra and the database. Your settings stay.'
    return (
      `Removes the spectra and the database. Your settings stay, but the example's ${listed(back)} ` +
      `${back.length === 1 ? 'goes' : 'go'} back to the preset's.`
    )
  })

  $effect(() => {
    let stop: (() => void) | null = null
    let gone = false
    void onFileDrop({
      over: (on) => (dragging = on),
      drop: (paths) => void addAnyFiles(paths),
    }).then((unlisten) => (gone ? unlisten() : (stop = unlisten)))
    return () => {
      gone = true
      stop?.()
    }
  })
</script>

<section data-testid="view-search" class="flex flex-col gap-4">
  <div class="flex flex-wrap items-start gap-x-4 gap-y-2">
    <div class="flex-1">
      <div class="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <h1 class="text-xl font-semibold tracking-tight">New search</h1>
        <!-- the window's project, beside the title (the window's title names it too) -->
        {#if project.name}
          <span class="rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground" data-testid="project-name">Project: {project.name}</span>
        {/if}
      </div>
      <p class="text-muted-foreground">Spectra and database stay on this computer.</p>
    </div>
    <!-- a project: the setup of this search and of the views, as a .prose-setup.json (src/lib/project) -->
    <div class="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={project.busy}
        title="Opens a project (.prose-setup.json): its files, design, database and settings here, and its search in Results if History has it"
        data-testid="open-setup"
        onclick={() => projectAction(() => openProject(), 'Open project')}>{project.busy ? 'Opening project…' : 'Open project…'}</Button>
      <Button
        variant="outline"
        size="sm"
        disabled={project.busy}
        title="Saves this setup and the state of the views as a project (.prose-setup.json), to set up the same search again"
        data-testid="save-setup"
        onclick={() => projectAction(() => saveProject(project.name === null), 'Save project')}
        >{project.name === null ? 'Save project…' : 'Save project'}</Button>
    </div>
    {#if form.files.length > 0 || form.database}
      <!-- the next search from scratch: no files, no database, the settings kept -->
      <Button
        variant="outline"
        size="sm"
        disabled={form.busy}
        title={startOverTitle}
        onclick={() => form.startOver()}>Start over</Button>
    {/if}
  </div>

  {#if projectError}
    <p class="text-sm text-destructive" role="alert" data-testid="project-error">{projectError}</p>
  {/if}
  {#if form.files.length === 0}
    <EmptyState {dragging} />
  {:else}
    <div class={dragging ? 'rounded-lg ring-2 ring-primary/40 ring-offset-2 ring-offset-background' : ''}>
      <DesignTable />
    </div>
  {/if}
  <DatabaseCard />
  <SettingsCard />
  <RescoringCard />
  <CheckNotices />
  <SearchFooter />
</section>
