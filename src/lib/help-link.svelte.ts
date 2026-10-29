// Links into Help from elsewhere in the app: the page and the section (an element id on it) to show. The hash
// carries the page (#/help/<page>); the section is scrolled to when the page shows.

import { HELP_PAGES, type HelpPage } from './route'
import { navigate } from './route.svelte'

export const helpTarget = $state<{ id: string | null }>({ id: null })

/**
 * The page of Help that holds section `id`: a page by its name, "faq-…" troubleshooting, "results-…" and
 * "help-groups" the results, "help-…" a setting, "fdr-…" the FDR, "basics-…" and "how" the basics, "learn-…" the
 * links; anything else troubleshooting, the first page.
 */
export function helpPageOf(id: string): HelpPage {
  if ((HELP_PAGES as readonly string[]).includes(id)) return id as HelpPage
  if (id.startsWith('faq-')) return 'troubleshooting'
  if (id === 'help-groups' || id.startsWith('results-')) return 'results'
  if (id.startsWith('help-')) return 'settings'
  if (id.startsWith('fdr')) return 'fdr'
  if (id === 'how' || id.startsWith('basics-')) return 'basics'
  if (id.startsWith('learn-')) return 'learn'
  return 'troubleshooting'
}

/** Opens Help at section `id` (e.g. "fdr", "help-psmFdr", "faq-few-ids"), or at a page. */
export function openHelp(id: string): void {
  const page = helpPageOf(id)
  helpTarget.id = id === page ? null : id
  navigate({ view: 'help', page })
}
