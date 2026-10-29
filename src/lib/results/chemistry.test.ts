import { describe, expect, test } from 'vitest'
import { sampleDesign } from './fixtures'
import { chemistryCard } from './chemistry'
import { buildModel } from './model'
import { makeTables } from './synthetic'

// The chemistry card (G2): cysteine peptides against the proteins, missed cleavages, label occupancy.

/** `n` tryptic peptides of 8 residues, each its own protein; `cys` of them (and of the proteins' other peptide) with a C. */
function model(n: number, opts: { cys: number; missed?: number; tmt?: number }) {
  const peptides = []
  const proteins = []
  const psms = []
  for (let i = 0; i < n; i++) {
    const missed = i < (opts.missed ?? 0)
    const body = i < opts.cys ? 'ACDEFGH' : 'ADDEFGH'
    const seq = missed ? `AKD${i < opts.cys ? "C" : "E"}FGHK` : `${body}K`
    // the protein: the peptide, then a tryptic partner with a C (so half its tryptic peptides have one)
    proteins.push({ accession: `P${i}`, description: '', sequence: `${seq}LCDEFGHR`, score: 1, qValue: 0.001 })
    const tmt = i < (opts.tmt ?? 0)
    peptides.push({ sequence: seq, proteins: [i], ...(tmt ? { mods: [{ position: 1, name: 'TMT6plex', unimod: 737, mass: 229.1629 }] } : {}) })
    psms.push({ peptide: i, file: 0, qValue: 0.001, score: 10 })
  }
  return buildModel(makeTables({ files: ['ctrl_a.mzML', 'egf_a.mzML'], proteins, peptides, psms }), sampleDesign(), {
    showTechReplicates: false,
    psmFdr: 0.01,
    proteinFdr: 1,
  })
}

describe('the chemistry card', () => {
  test('few cysteine peptides against the proteins: the alkylation is named', () => {
    const card = chemistryCard(model(120, { cys: 0 }), { enzyme: 'Trypsin/P' }, ['Carbamidomethyl (C)'])!
    expect(card.cysteine).toEqual({ observed: 0, expected: 0.5 })
    expect(card.notes[0]).toMatch(/^Only 0 % of the peptides have a cysteine, where about 50 % is expected from the proteins: the alkylation/)
    expect(chemistryCard(model(120, { cys: 60 }), { enzyme: 'Trypsin/P' }, ['Carbamidomethyl (C)'])!.notes).toEqual([])
  })

  test('missed cleavages and a partial variable label', () => {
    const card = chemistryCard(model(120, { cys: 60, missed: 60, tmt: 30 }), { enzyme: 'Trypsin/P', 'modifications:variable': ['TMT6plex (K)'] }, [])!
    expect(card.missedCleavages).toBeCloseTo(0.5)
    expect(card.labelOccupancy).toBeCloseTo(0.25)
    expect(card.notes.map((n) => n.split(':')[0])).toEqual(['50 % of the peptides have a missed cleavage', 'TMT6plex is on K in 25 % of the peptides with a K'])
  })

  test('too few peptides, or another enzyme: no cysteine or cleavage figures', () => {
    expect(chemistryCard(model(20, { cys: 0 }), {}, [])).toBeNull()
    const card = chemistryCard(model(120, { cys: 0 }), { enzyme: 'Lys-C' }, [])!
    expect([card.cysteine, card.missedCleavages]).toEqual([null, null])
  })
})
