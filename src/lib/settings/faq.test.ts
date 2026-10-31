import { describe, expect, it } from 'vitest'
import { FAQ, FAQ_GROUPS, faqFor } from './faq'

/**
 * The ids the app's checks report that a user can act on: start checks (`search/checks.ts`, `spectra.ts`,
 * `database.ts`, `chemistry.ts`), diagnosis causes and the card's own id (`results/diagnosis.ts`, presets'
 * `expected`), tolerance findings (`results/tolerance.ts`), checks of a finished search (`results/sanity.ts`)
 * and the input warnings of Overview (`results/overview.ts`), the plausibility of the settings
 * (`search/plausibility.ts`). Left out: `adding`, `database-counting` and `inspecting` (Start waits; nothing to fix).
 */
const ACTIONABLE = [
  'no-files', 'sdrf', 'file-problem', 'design-cell', 'no-database', 'database-error', 'database-problem',
  'range-inverted', 'range-outside', 'psm-fdr', 'unknown-modification', 'tool',
  'profile-ms2', 'no-ms2', 'dia-suspected', 'no-charge', 'iontrap-ppm', 'spectra-not-checked', 'spectra-not-read',
  'decoys-twice', 'decoy-ratio', 'organism-mismatch',
  'many-variable-mods', 'fragment-tolerance-wide', 'fragment-tolerance-narrow', 'fragment-da-highres',
  'precursor-da-typo', 'precursor-da-wide', 'iontrap-precursor-ppm', 'sdrf-modifications', 'sdrf-label',
  'low-id-rate', 'charge', 'percolator', 'contaminants', 'small-run',
  'tolerance-offset', 'tolerance-edge', 'tolerance-too-wide',
  'runs-missing', 'spectra-mismatch', 'no-decoys', 'all-q-zero', 'isotope-share', 'rt-unit', 'parameter-echo',
  'profile', 'chemistry-cysteine', 'chemistry-missed-cleavages', 'chemistry-non-specific', 'chemistry-label',
  'fractions-no-replicates',
]

describe('FAQ', () => {
  it('has unique faq- ids', () => {
    const ids = FAQ.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^faq-[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it('gives every entry causes and fixes, and a known group', () => {
    const groups = new Set(FAQ_GROUPS.map((g) => g.id))
    for (const e of FAQ) {
      expect(e.causes.length, e.id).toBeGreaterThan(0)
      expect(e.fixes.length, e.id).toBeGreaterThan(0)
      expect(groups.has(e.group), e.id).toBe(true)
    }
  })

  it('links each actionable check id to an entry', () => {
    for (const id of ACTIONABLE) expect(faqFor(id), id).toBeDefined()
  })

  it('has no check id in two entries', () => {
    const all = FAQ.flatMap((e) => e.checks ?? [])
    expect(new Set(all).size).toBe(all.length)
  })

  it('finds nothing for an unknown id', () => {
    expect(faqFor('no-such-check')).toBeUndefined()
  })
})
