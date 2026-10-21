<script lang="ts">
  // Closing the window while a search runs: the app keeps the window and asks here first. Closing ends
  // ProSE, and the search leaves nothing behind; "Keep searching" leaves the window open. (Closing the
  // window again before an answer closes it: the app's rule, src-tauri/src/lib.rs `close_requested`.)
  import { Button } from '$lib/components/ui/button'
  import * as Dialog from '$lib/components/ui/dialog'
  import { answerClose, onCloseRequested } from '$lib/desktop'
  import { onMount } from 'svelte'

  let open = $state(false)
  /** The question has been answered with a button (the dialog's own close is "keep"). */
  let answered = false

  onMount(() => {
    let stop: (() => void) | null = null
    let gone = false
    void onCloseRequested(() => {
      answered = false
      open = true
    }).then((unlisten) => {
      if (gone) unlisten()
      else stop = unlisten
    })
    return () => {
      gone = true
      stop?.()
    }
  })

  function answer(close: boolean) {
    answered = true
    open = false
    void answerClose(close)
  }
</script>

<Dialog.Root
  bind:open
  onOpenChange={(next) => {
    if (!next && !answered) void answerClose(false)
  }}>
  <Dialog.Content class="gap-4 sm:max-w-sm" data-testid="close-guard">
    <Dialog.Header>
      <Dialog.Title>A search is running</Dialog.Title>
      <Dialog.Description>
        Closing ProSE now ends the search, and nothing of it is kept.
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer>
      <Button variant="outline" size="sm" onclick={() => answer(false)}>Keep searching</Button>
      <Button variant="destructive" size="sm" onclick={() => answer(true)}>Close ProSE</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
