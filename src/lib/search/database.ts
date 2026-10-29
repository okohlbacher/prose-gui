// What New search says about the chosen FASTA (guidance G6): a one-line summary of its entries for the database
// card (organisms, header style, isoforms, contaminants, decoys), and the checks on it: decoys in the database
// while the setting generates more, and an SDRF organism that is not the database's main one. A FASTA of several
// organisms is not warned about by itself: xenografts, host-pathogen and spike-in samples need one.

import type { FastaSummary } from '../desktop'
import type { SdrfTable } from '../design/sdrf-table'
import type { Check } from './checks'

/** "Homo sapiens (20,401 of 20,420 entries) · UniProt headers · 1,532 isoforms · 116 contaminants · no decoys" */
export function fastaLine(s: FastaSummary, proteins: number): string {
  const n = (x: number) => x.toLocaleString('en-US')
  const parts: string[] = []
  if (s.organisms.length > 0) {
    const [name, count] = s.organisms[0]
    parts.push(`${name} (${n(count)} of ${n(proteins)} entries)`)
    if (s.organismCount > 1) parts.push(`${n(s.organismCount)} organisms`)
  } else {
    parts.push('no organism in the headers')
  }
  if (s.uniprot > 0) parts.push(s.uniprot === proteins ? 'UniProt headers' : `${n(s.uniprot)} UniProt headers`)
  if (s.isoforms > 0) parts.push(`${n(s.isoforms)} ${s.isoforms === 1 ? 'isoform' : 'isoforms'}`)
  if (s.contaminants > 0) parts.push(`${n(s.contaminants)} ${s.contaminants === 1 ? 'contaminant' : 'contaminants'}`)
  parts.push(s.decoyMarker ? `${n(s.decoys)} decoys (${s.decoyMarker})` : 'no decoys')
  return parts.join(' · ')
}

/** The genus and species of an organism name, lower case ("homo sapiens" of "Homo sapiens (Human)"). */
const species = (name: string) => name.toLowerCase().replace(/\(.*?\)/g, ' ').trim().split(/\s+/).slice(0, 2).join(' ')

/** The organisms of an SDRF's characteristics[organism] column (distinct, as written). */
export function sdrfOrganisms(table: SdrfTable | null): string[] {
  if (!table) return []
  const col = table.headers.findIndex((h) => h.trim().toLowerCase() === 'characteristics[organism]')
  if (col < 0) return []
  const values = table.rows.map((r) => (r[col] ?? '').trim()).filter((v) => v !== '' && !/^not (available|applicable)$/i.test(v))
  return [...new Set(values)]
}

/** The checks of the database: its decoys against the setting, the SDRF's organism against its main one. */
export function databaseChecks(s: FastaSummary | undefined, decoySetting: string, sdrfOrganism: string[], setDecoys: (v: string) => void): Check[] {
  if (!s) return []
  const out: Check[] = []
  if (s.decoyMarker && decoySetting === 'generate') {
    out.push({
      id: 'decoys-twice',
      level: 'warn',
      source: 'database',
      message: `The database has decoys of its own (${s.decoys.toLocaleString('en-US')}, marked ${s.decoyMarker}), and ProSE would generate more: the decoys of the database would count as targets.`,
      action: { label: 'Use the database’s decoys', run: () => setDecoys('auto') },
    })
  }
  const main = s.organisms[0]?.[0]
  if (main && sdrfOrganism.length > 0) {
    const all = new Set(s.organisms.map(([o]) => species(o)))
    const missing = sdrfOrganism.filter((o) => !all.has(species(o)) && species(o) !== species(main))
    if (missing.length > 0) {
      out.push({
        id: 'organism-mismatch',
        level: 'warn',
        source: 'database',
        message: `The SDRF names ${missing.join(', ')} as the organism, but the database's entries are mostly ${main}. Check that it is the right database.`,
      })
    }
  }
  return out
}
