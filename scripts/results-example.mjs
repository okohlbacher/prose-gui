// The searches of the results reader's fixtures, as both fixture scripts run them:
// results-fixture-native.mjs with the ProSE tool (in a search folder as the shim makes it) and
// results-fixture-web.mjs with the web app's WebAssembly module (as the web app's engine calls it).
//
// The data: the web app's example (WEB_PUBLIC, default the web app's `app/public` on the development
// machine) and OpenMS' TOPP test data (OPENMS_TOPP, default the pin's `src/tests/topp`).

import { resolve } from 'node:path'

const WEB_PUBLIC = process.env.WEB_PUBLIC ?? '/scratch/sachsenb/prose-pages/app/public'
const OPENMS_TOPP = process.env.OPENMS_TOPP ?? '/scratch/sachsenb/openms-desktop/src/tests/topp'

/** The cRAP of the web app, which the shim bundles as well (src-tauri/resources/fasta/crap.fasta). */
export const CRAP = resolve(WEB_PUBLIC, 'fasta/crap.fasta')

/** The preset `orbitrap-hcd-tryptic` (prose-pages app/src/lib/settings/presets.ts). */
const ORBITRAP = {
  enzyme: 'Trypsin/P',
  'peptide:enzyme_specificity': 'full',
  'peptide:missed_cleavages': 2,
  'modifications:fixed': ['Carbamidomethyl (C)'],
  'modifications:variable': ['Oxidation (M)', 'Acetyl (Protein N-term)'],
  'FDR:PSM': 0.01,
  'FDR:protein': 0.01,
  'precursor:min_charge': 2,
  'precursor:max_charge': 5,
  'peptide:min_size': 7,
  'peptide:max_size': 40,
  'precursor:mass_tolerance_lower': 10,
  'precursor:mass_tolerance_upper': 10,
  'precursor:mass_tolerance_unit': 'ppm',
  'fragment:mass_tolerance': 20,
  'fragment:mass_tolerance_unit': 'ppm',
  'peptdeep:instrument': 'QE',
}

/**
 * name → { mzML: the file searched, names: the inputs (the file under each name), fasta, contaminants,
 * parameters, rescore, peptdeep }
 */
export const CASES = {
  // The web app's example (app/src/lib/search/form.svelte.ts `EXAMPLE`): one mzML searched as two
  // replicates, its FASTA with the contaminants (the form's default), the default preset with the
  // example's protein FDR of 5 %, Percolator and PeptDeep.
  example: {
    mzML: resolve(WEB_PUBLIC, 'example/DatabaseSuitability_in_spec.mzML'),
    names: ['DatabaseSuitability_1.mzML', 'DatabaseSuitability_2.mzML'],
    fasta: resolve(WEB_PUBLIC, 'example/DatabaseSuitability_database.fasta'),
    contaminants: true,
    parameters: { ...ORBITRAP, 'FDR:protein': 0.05 },
    rescore: true,
    peptdeep: true,
  },
  // Modified peptides (the example has none): ProSE's TOPP test data of ProSE_1 (SimpleSearchEngine_1),
  // with its settings (Trypsin, 5 ppm, 0.1 Da, Carbamidomethyl (C) fixed, Oxidation (M) variable), the
  // N-terminal acetylation of the preset, generated decoys and the FDR filters off (0 filters nothing:
  // the shim requires FDR:PSM > 0, so 1).
  mods: {
    mzML: resolve(OPENMS_TOPP, 'SimpleSearchEngine_1.mzML'),
    names: ['SimpleSearchEngine_1.mzML'],
    fasta: resolve(OPENMS_TOPP, 'SimpleSearchEngine_1.fasta'),
    contaminants: false,
    parameters: {
      enzyme: 'Trypsin',
      'peptide:missed_cleavages': 1,
      'modifications:fixed': ['Carbamidomethyl (C)'],
      'modifications:variable': ['Oxidation (M)', 'Acetyl (Protein N-term)'],
      'FDR:PSM': 1,
      'precursor:mass_tolerance_lower': 5,
      'precursor:mass_tolerance_upper': 5,
      'precursor:mass_tolerance_unit': 'ppm',
      'fragment:mass_tolerance': 0.1,
      'fragment:mass_tolerance_unit': 'Da',
    },
    rescore: false,
    peptdeep: false,
  },
  // An open search (the modification analysis, delta masses): the data of `mods` with the settings of the
  // preset `open-search` (±500 Da, no variable modifications, isotope errors 0).
  open: {
    mzML: resolve(OPENMS_TOPP, 'SimpleSearchEngine_1.mzML'),
    names: ['SimpleSearchEngine_1.mzML'],
    fasta: resolve(OPENMS_TOPP, 'SimpleSearchEngine_1.fasta'),
    contaminants: false,
    parameters: {
      enzyme: 'Trypsin',
      'peptide:missed_cleavages': 1,
      'modifications:fixed': ['Carbamidomethyl (C)'],
      'modifications:variable': [],
      'FDR:PSM': 1,
      'precursor:mass_tolerance_lower': 500,
      'precursor:mass_tolerance_upper': 500,
      'precursor:mass_tolerance_unit': 'Da',
      'precursor:isotope_error_min': 0,
      'precursor:isotope_error_max': 0,
      'fragment:mass_tolerance': 0.1,
      'fragment:mass_tolerance_unit': 'Da',
    },
    rescore: false,
    peptdeep: false,
  },
  // A search in which no PSM passes the FDR (as a search on the wrong database): ProSE's TOPP test data of
  // ProSE_15_empty, whose decoys (DECOY_, reused by decoys auto) are the real proteins of the example and its targets
  // their reversed sequences, so the spectra match decoys only. Two inputs (the merged files) with the PSM and protein
  // FDR at 1 % and Percolator. No web counterpart: the reader's test checks that it reads as an empty result.
  empty: {
    mzML: resolve(OPENMS_TOPP, 'THIRDPARTY/DatabaseSuitability_in_spec.mzML'),
    names: ['DatabaseSuitability_1.mzML', 'DatabaseSuitability_2.mzML'],
    fasta: resolve(OPENMS_TOPP, 'ProSE_15_empty.fasta'),
    contaminants: false,
    parameters: { ...ORBITRAP, 'FDR:protein': 0.01 },
    rescore: true,
    peptdeep: false,
  },
}

export function getCase(name) {
  const c = CASES[name]
  if (!c) throw new Error(`no fixture case ${name} (${Object.keys(CASES).join(', ')})`)
  return c
}
