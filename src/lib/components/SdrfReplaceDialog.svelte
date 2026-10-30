<script lang="ts">
  // Save Project with an SDRF made with "Create SDRF…" (no file yet), when the `<name>.sdrf.tsv` it is written to
  // beside the project is there already: asked here first. "Replace" writes over it; "Keep the file" saves the
  // project without the SDRF.
  import { Button } from '$lib/components/ui/button'
  import * as Dialog from '$lib/components/ui/dialog'
  import { answerSdrfReplace, project } from '$lib/project/project.svelte'
  import { fileName } from '$lib/search/form.svelte'
</script>

<!-- (closed with Escape or outside: as "Keep the file") -->
<Dialog.Root
  bind:open={() => project.confirmSdrf !== null, (v) => {
    if (!v && project.confirmSdrf !== null) answerSdrfReplace(false)
  }}>
  <Dialog.Content class="gap-4 sm:max-w-sm" data-testid="sdrf-replace-guard">
    <Dialog.Header>
      <Dialog.Title>Replace {project.confirmSdrf ? fileName(project.confirmSdrf) : 'the SDRF'}?</Dialog.Title>
      <Dialog.Description>
        The SDRF you created is saved beside the project, but a file of that name is there already. Replace it, or
        keep it and save the project without your SDRF.
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer>
      <Button variant="outline" size="sm" onclick={() => answerSdrfReplace(false)}>Keep the file</Button>
      <Button size="sm" onclick={() => answerSdrfReplace(true)} data-testid="sdrf-replace">Replace</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
