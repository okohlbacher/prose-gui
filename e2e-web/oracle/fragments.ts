// The fragment ions of a peptide, computed here from first principles for the oracle tests: monoisotopic residue
// masses (Unimod / NIST), the proton 1.007276 u and water 18.010565 u. Independent of the app's chemistry
// (src/lib/chemistry, src/lib/psm), which the ion table and the spectrum labels come from.

export const PROTON = 1.007276
export const WATER = 18.010565

/** Monoisotopic residue masses (u). */
export const RESIDUE: Record<string, number> = {
  G: 57.021464, A: 71.037114, S: 87.032028, P: 97.052764, V: 99.068414, T: 101.047679, C: 103.009185, L: 113.084064,
  I: 113.084064, N: 114.042927, D: 115.026943, Q: 128.058578, K: 128.094963, E: 129.042593, M: 131.040485, H: 137.058912,
  F: 147.068414, R: 156.101111, Y: 163.06332, W: 186.079313, U: 150.95363, O: 237.147727,
}

/** Monoisotopic mass deltas of the modifications the fixtures use, by Unimod accession. */
export const MODIFICATION: Record<string, number> = {
  'UNIMOD:4': 57.021464, // Carbamidomethyl
  'UNIMOD:35': 15.994915, // Oxidation
  'UNIMOD:1': 42.010565, // Acetyl
  'UNIMOD:21': 79.966331, // Phospho
  'UNIMOD:7': 0.984016, // Deamidated
  'UNIMOD:28': -17.026549, // Gln->pyro-Glu
  'UNIMOD:27': -18.010565, // Glu->pyro-Glu
}

export interface Ion {
  /** 'b3', 'y5', 'b4++' */
  name: string
  type: 'b' | 'y'
  ordinal: number
  charge: number
  mz: number
}

/**
 * The b and y ions of `sequence` (ordinals 1 to n − 1) at charges 1..maxCharge. `mods`: mass deltas by 1-based
 * position (0: N-terminus, n + 1: C-terminus).
 */
export function byIons(sequence: string, mods: Map<number, number> = new Map(), maxCharge = 1): Ion[] {
  const n = sequence.length
  const residue = (i: number) => {
    const m = RESIDUE[sequence[i]]
    if (m === undefined) throw new Error(`no mass for residue ${sequence[i]}`)
    return m + (mods.get(i + 1) ?? 0)
  }
  const nTerm = mods.get(0) ?? 0
  const cTerm = mods.get(n + 1) ?? 0
  const ions: Ion[] = []
  for (let z = 1; z <= maxCharge; z++) {
    const plus = z === 1 ? '' : '+'.repeat(z)
    let prefix = nTerm
    for (let k = 1; k < n; k++) {
      prefix += residue(k - 1)
      ions.push({ name: `b${k}${plus}`, type: 'b', ordinal: k, charge: z, mz: (prefix + z * PROTON) / z })
    }
    let suffix = cTerm + WATER
    for (let k = 1; k < n; k++) {
      suffix += residue(n - k)
      ions.push({ name: `y${k}${plus}`, type: 'y', ordinal: k, charge: z, mz: (suffix + z * PROTON) / z })
    }
  }
  return ions
}

/** The ions with a peak within `toleranceDa` (absolute), each with its closest peak. */
export function matchIons(ions: Ion[], peaks: number[], toleranceDa: number): Map<string, number> {
  const out = new Map<string, number>()
  for (const ion of ions) {
    let best = -1
    for (let i = 0; i < peaks.length; i++) {
      if (Math.abs(peaks[i] - ion.mz) <= toleranceDa && (best < 0 || Math.abs(peaks[i] - ion.mz) < Math.abs(peaks[best] - ion.mz))) best = i
    }
    if (best >= 0) out.set(ion.name, peaks[best])
  }
  return out
}
