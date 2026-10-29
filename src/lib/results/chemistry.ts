// The chemistry card of a result (guidance G2, after the search): does the sample chemistry fit the search?
// From the passing target peptides: the share with a cysteine against the share expected from the identified
// proteins (a missing or different alkylation loses cysteine peptides), the occupancy of a variable isobaric label
// on K, and the missed-cleavage and non-specific-terminus rates (another enzyme, or poor digestion). Tryptic
// searches only for the cysteine and cleavage figures: the expected share needs the enzyme's rule.

import { levelRows } from './figures'
import type { ResultModel } from './model'

/** Cysteine peptides below this share of the expected one: the alkylation may not be what the search assumes. */
export const CYS_RATIO_LOW = 0.5
/** A variable isobaric label on fewer K-peptides than this: labelling was incomplete (or the sample is not labelled). */
export const LABEL_OCCUPANCY_LOW = 0.9
/** Missed cleavages in more than this share of a tryptic search's peptides: digestion or enzyme setting off. */
export const MISSED_CLEAVAGE_HIGH = 0.3
/** Non-specific termini in more than this share (of a semi-specific search): in-source decay, or another enzyme. */
export const NONSPECIFIC_HIGH = 0.3
/** Fewer passing peptides than this give no reliable shares. */
export const MIN_PEPTIDES = 100

/** Tryptic peptides of 7–40 residues of `sequence` (cut after K/R, not before P) and whether each has a C. */
function trypticCys(sequence: string): { all: number; withC: number } {
  let all = 0
  let withC = 0
  let start = 0
  for (let i = 0; i < sequence.length; i++) {
    const c = sequence[i]
    const end = i === sequence.length - 1 || ((c === 'K' || c === 'R') && sequence[i + 1] !== 'P')
    if (!end) continue
    const len = i + 1 - start
    if (len >= 7 && len <= 40) {
      all++
      if (sequence.slice(start, i + 1).includes('C')) withC++
    }
    start = i + 1
  }
  return { all, withC }
}

const isCleavage = (seq: string, i: number) => (seq[i] === 'K' || seq[i] === 'R') && seq[i + 1] !== 'P'

export type ChemistryCard = {
  peptides: number
  /** Shares 0–1; null: not computed (another enzyme, no label, too few peptides). */
  cysteine: { observed: number; expected: number } | null
  labelOccupancy: number | null
  missedCleavages: number | null
  nonSpecific: number | null
  /** What looks off, in sentences. */
  notes: string[]
  /** The kind of each note, in the order of `notes` (for Help: `settings/faq.ts`). */
  noteIds: ChemistryNoteId[]
}

export type ChemistryNoteId = 'chemistry-cysteine' | 'chemistry-missed-cleavages' | 'chemistry-non-specific' | 'chemistry-label'

export function chemistryCard(m: ResultModel, parameters: Record<string, unknown>, fixedMods: string[]): ChemistryCard | null {
  const rows = levelRows(m, 'peptides', false)
  if (rows.length < MIN_PEPTIDES) return null
  const pt = m.tables.peptides
  const pr = m.tables.proteins
  const enzyme = String(parameters.enzyme ?? 'Trypsin')
  const tryptic = /^Trypsin/.test(enzyme)
  const specificity = String(parameters['peptide:enzyme_specificity'] ?? 'full')
  const variable = (parameters['modifications:variable'] as string[] | undefined) ?? []
  const pct = (x: number) => `${(x * 100).toFixed(0)} %`
  const notes: string[] = []
  const noteIds: ChemistryNoteId[] = []
  const note = (id: ChemistryNoteId, text: string) => {
    noteIds.push(id)
    notes.push(text)
  }

  let withC = 0
  let missed = 0
  let nonSpecific = 0
  let kPeptides = 0
  let kLabelled = 0
  const proteins = new Set<number>()
  const label = variable.find((v) => /^(TMT|iTRAQ)/i.test(v))
  const labelName = label?.split(' (')[0]
  for (const k of rows) {
    const seq = pt.sequence[k]
    if (seq.includes('C')) withC++
    for (let i = 0; i < seq.length - 1; i++) if (isCleavage(seq, i)) {
      missed++
      break
    }
    const a = pt.proteinOffsets[k]
    if (a < pt.proteinOffsets[k + 1]) {
      const p = pt.protein[a]
      proteins.add(p)
      const protein = pr.sequence[p]
      const start = pt.start[a]
      const end = pt.end[a]
      if (protein) {
        const nOk = start <= 1 || isCleavage(protein, start - 1)
        const cOk = end >= protein.length || isCleavage(protein, end - 1)
        if (!nOk || !cOk) nonSpecific++
      }
    }
    if (labelName && seq.includes('K')) {
      kPeptides++
      for (let j = pt.modOffsets[k]; j < pt.modOffsets[k + 1]; j++) {
        if (pt.modName[j] === labelName && seq[pt.modPosition[j]] === 'K') {
          kLabelled++
          break
        }
      }
    }
  }
  const n = rows.length
  let cysteine: ChemistryCard['cysteine'] = null
  if (tryptic) {
    let all = 0
    let c = 0
    for (const p of proteins) {
      const t = trypticCys(pr.sequence[p] ?? '')
      all += t.all
      c += t.withC
    }
    if (all > 0) {
      cysteine = { observed: withC / n, expected: c / all }
      if (cysteine.observed < CYS_RATIO_LOW * cysteine.expected) {
        note(
          'chemistry-cysteine',
          fixedMods.some((f) => /\(C\)/.test(f))
            ? `Only ${pct(cysteine.observed)} of the peptides have a cysteine, where about ${pct(cysteine.expected)} is expected from the proteins: the alkylation of the sample may not be the fixed ${fixedMods.find((f) => /\(C\)/.test(f))} of the search.`
            : `Only ${pct(cysteine.observed)} of the peptides have a cysteine, where about ${pct(cysteine.expected)} is expected: the search has no fixed modification on C. If the sample was alkylated, add it (e.g. Carbamidomethyl (C)).`,
        )
      }
    }
  }
  const missedCleavages = tryptic ? missed / n : null
  if (missedCleavages !== null && missedCleavages > MISSED_CLEAVAGE_HIGH) {
    note('chemistry-missed-cleavages', `${pct(missedCleavages)} of the peptides have a missed cleavage: the digestion was incomplete, or the sample was digested with another enzyme than ${enzyme}.`)
  }
  const nonSpecificShare = tryptic && specificity !== 'full' ? nonSpecific / n : null
  if (nonSpecificShare !== null && nonSpecificShare > NONSPECIFIC_HIGH) {
    note('chemistry-non-specific', `${pct(nonSpecificShare)} of the peptides have a non-tryptic end: in-source fragments, or another enzyme.`)
  }
  const labelOccupancy = labelName && kPeptides > 0 ? kLabelled / kPeptides : null
  if (labelOccupancy !== null && labelOccupancy < LABEL_OCCUPANCY_LOW) {
    note('chemistry-label', `${labelName} is on K in ${pct(labelOccupancy)} of the peptides with a K: the labelling was incomplete, or the samples are not labelled with it.`)
  }
  return { peptides: n, cysteine, labelOccupancy, missedCleavages, nonSpecific: nonSpecificShare, notes, noteIds }
}
