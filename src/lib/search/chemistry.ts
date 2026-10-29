// The sample chemistry against the search (guidance G2), as far as it needs no new ProSE output: before the
// search, the SDRF's modifications and labels against the chosen modifications; after it, a chemistry card from
// the passing PSMs (cysteine peptides against the share expected, the label on K and the N-terminus, missed and
// non-specific cleavages). A wrong alkylation, label or enzyme gives plausible results with fewer IDs and is almost
// never noticed (paper, issue 1).

import type { SdrfTable } from '../design/sdrf-table'
import type { Check } from './checks'

/** One modification of an SDRF's comment[modification parameters] as ProSE names it ("Phospho (S)"), per site. */
export type SdrfModification = { names: string[]; type: 'fixed' | 'variable'; text: string }

/** "NT=Phospho;AC=UNIMOD:21;TA=S,T,Y;MT=Variable" → Phospho (S), Phospho (T), Phospho (Y). */
export function parseSdrfModification(text: string): SdrfModification | null {
  const fields = new Map<string, string>()
  for (const part of text.split(';')) {
    const at = part.indexOf('=')
    if (at > 0) fields.set(part.slice(0, at).trim().toUpperCase(), part.slice(at + 1).trim())
  }
  const name = fields.get('NT')
  if (!name) return null
  const sites = (fields.get('TA') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const pp = fields.get('PP') ?? ''
  const term = /^(Protein|Any)\s+([NC])-term$/i.exec(pp)
  const termSite = term ? `${/^protein$/i.test(term[1]) ? 'Protein ' : ''}${term[2].toUpperCase()}-term` : null
  const names = termSite
    ? sites.length > 0
      ? sites.map((s) => `${name} (${termSite} ${s})`)
      : [`${name} (${termSite})`]
    : sites.map((s) => `${name} (${s})`)
  return { names, type: /fixed/i.test(fields.get('MT') ?? '') ? 'fixed' : 'variable', text }
}

const key = (mod: string) => mod.trim().toLowerCase()

/** The SDRF's modifications and labels, distinct. */
export function sdrfChemistry(table: SdrfTable | null): { mods: SdrfModification[]; labels: string[] } {
  if (!table) return { mods: [], labels: [] }
  const cols = (name: string) => table.headers.flatMap((h, k) => (h.trim().toLowerCase() === name ? [k] : []))
  const values = (name: string) => [...new Set(cols(name).flatMap((c) => table.rows.map((r) => (r[c] ?? '').trim())))].filter((v) => v && !/^not (available|applicable)$/i.test(v))
  return {
    mods: values('comment[modification parameters]').map(parseSdrfModification).filter((m): m is SdrfModification => m !== null),
    labels: values('comment[label]'),
  }
}

/**
 * What the SDRF says about the sample that the settings do not search for: its modifications missing from the
 * chosen ones, and an isobaric label (TMT, iTRAQ) without a label modification.
 */
export function sdrfChemistryChecks(table: SdrfTable | null, fixed: string[], variable: string[]): Check[] {
  const { mods, labels } = sdrfChemistry(table)
  const chosen = new Set([...fixed, ...variable].map(key))
  const out: Check[] = []
  const missing = mods.flatMap((m) => m.names.filter((n) => !chosen.has(key(n))).map((n) => `${n} (${m.type})`))
  if (missing.length > 0) {
    out.push({
      id: 'sdrf-modifications',
      level: 'warn',
      source: 'sdrf',
      message: `The SDRF lists ${missing.length === 1 ? 'a modification' : 'modifications'} the search does not include: ${missing.join(', ')}. Add ${missing.length === 1 ? 'it' : 'them'} under Search settings, or correct the SDRF.`,
    })
  }
  const isobaric = labels.filter((l) => /^(TMT|iTRAQ)/i.test(l))
  const labelMod = [...fixed, ...variable].some((m) => /^(TMT|iTRAQ)/i.test(m))
  if (isobaric.length > 0 && !labelMod) {
    out.push({
      id: 'sdrf-label',
      level: 'warn',
      source: 'sdrf',
      message: `The SDRF labels the samples ${isobaric.slice(0, 3).join(', ')}${isobaric.length > 3 ? ', …' : ''}, but the search has no TMT or iTRAQ modification: labelled peptides would not be identified.`,
    })
  }
  return out
}
