// Showing a section of Help that a link asked for: a troubleshooting entry (a <details>) is opened, the section is
// scrolled into view (smoothly only when the system does not ask for reduced motion) and gets the focus, so that
// keyboard and screen-reader users land where the link pointed (a heading gets tabindex -1 for it).

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Opens, scrolls to and focuses the element `id`; false if there is none. */
export function revealSection(id: string, smooth = false): boolean {
  const el = document.getElementById(id)
  if (!el) return false
  if (el instanceof HTMLDetailsElement) el.open = true
  el.scrollIntoView({ block: 'start', behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' })
  const focus = el instanceof HTMLDetailsElement ? el.querySelector('summary') : el
  if (focus instanceof HTMLElement) {
    if (focus.tagName !== 'SUMMARY' && !focus.hasAttribute('tabindex')) focus.setAttribute('tabindex', '-1')
    focus.focus({ preventScroll: true })
  }
  return true
}
