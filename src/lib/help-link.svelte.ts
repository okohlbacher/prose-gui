// Links into the Help page from elsewhere in the app: the section (an element id on the Help page) to show
// when it opens. The hash is the app's route, so a section is not part of the URL.

import { navigate } from './route.svelte'

export const helpTarget = $state<{ id: string | null }>({ id: null })

/** Opens Help at section `id` (e.g. "fdr", "help-psmFdr"). */
export function openHelp(id: string): void {
  helpTarget.id = id
  navigate({ view: 'help' })
}
