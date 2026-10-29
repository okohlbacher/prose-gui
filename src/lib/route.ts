// The views of the app and their URL hashes: #/search, #/results[/<id>], #/history, #/help[/<page>].

export type View = 'search' | 'results' | 'history' | 'help'

export type Route =
  | { view: 'search' }
  | { view: 'results'; id: string | null }
  | { view: 'history' }
  | { view: 'help'; page?: HelpPage }

export const views: readonly View[] = ['search', 'results', 'history', 'help']

/** The pages of Help, in the order of its navigation. */
export const HELP_PAGES = ['troubleshooting', 'results', 'fdr', 'settings', 'formats', 'basics', 'learn'] as const
export type HelpPage = (typeof HELP_PAGES)[number]

/** The route of a location hash; anything unknown or malformed is the search view. */
export function parseHash(hash: string): Route {
  const segments = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  switch (segments[0]) {
    case 'history':
      return { view: 'history' }
    case 'help':
      return (HELP_PAGES as readonly string[]).includes(segments[1] ?? '') ? { view: 'help', page: segments[1] as HelpPage } : { view: 'help' }
    case 'results':
      try {
        return { view: 'results', id: segments[1] === undefined ? null : decodeURIComponent(segments[1]) }
      } catch {
        return { view: 'search' }
      }
    default:
      return { view: 'search' }
  }
}

/** The canonical hash of a route; `parseHash(formatHash(r))` gives `r` back. */
export function formatHash(route: Route): string {
  if (route.view === 'results') {
    return route.id === null ? '#/results' : `#/results/${encodeURIComponent(route.id)}`
  }
  if (route.view === 'help' && route.page) return `#/help/${route.page}`
  return `#/${route.view}`
}
