<script lang="ts">
  // File › New Search while the opened project has changes that are not saved: asked here first (as the close guard
  // asks). "Save project" saves them and then starts the new setup; "Discard" starts it without saving; Cancel keeps all.
  import { Button } from '$lib/components/ui/button'
  import * as Dialog from '$lib/components/ui/dialog'
  import { errorText } from '$lib/desktop'
  import { newSetup, project, saveProject } from '$lib/project/project.svelte'

  let error = $state<string | null>(null)

  async function saveFirst() {
    error = null
    try {
      if ((await saveProject(false)) !== null) newSetup(true)
    } catch (e) {
      error = errorText(e)
    }
  }
</script>

<Dialog.Root bind:open={project.confirmNew}>
  <Dialog.Content class="gap-4 sm:max-w-sm" data-testid="new-setup-guard">
    <Dialog.Header>
      <Dialog.Title>Save the changes to “{project.name}”?</Dialog.Title>
      <Dialog.Description>
        A new search starts from an empty setup. The changes you made since the project was opened or saved are lost
        unless you save them.
      </Dialog.Description>
    </Dialog.Header>
    {#if error}<p class="text-xs text-destructive" role="alert">{error}</p>{/if}
    <Dialog.Footer>
      <Button variant="outline" size="sm" onclick={() => (project.confirmNew = false)}>Cancel</Button>
      <Button variant="outline" size="sm" onclick={() => newSetup(true)} data-testid="new-setup-discard">Discard changes</Button>
      <Button size="sm" onclick={saveFirst}>Save project</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
