// The explanations behind the "?" of New search: what a setting does, for someone who has not run a
// search engine before, and when to change it (`tip`). Plain words; the parameter names are ProSE's. The Help
// page's settings section shows them all (`views/help/HelpSettings.svelte`).

export const HELP = {
  setup: {
    title: 'Preset',
    text: 'A preset fills in the settings that depend on the instrument: how exact its precursor (MS1) and fragment (MS2) masses are, and which model predicts its spectra. Choose the instrument that recorded the spectra. The built-in presets assume a tryptic digest and alkylated cysteines (Carbamidomethyl); check the enzyme and the modifications against your sample preparation.',
    tip: 'Save your own preset (with its database, e.g. one per organism) with “Save as preset”. A preset keeps the settings and a database, not the Percolator and PeptDeep switches; to repeat a search, open it from History.',
  },
  database: {
    title: 'Protein database (FASTA)',
    text: 'The protein sequences the spectra are matched against: usually the reference proteome of the organism the sample came from. Only peptides of these proteins can be identified.',
    tip: 'No FASTA at hand? Download the organism’s reference proteome from UniProt here. Reviewed (Swiss-Prot) entries only gives a smaller, faster search and is a good default for well-studied organisms (human, mouse, yeast, E. coli). For other organisms it can miss many proteins: a protein that is not in the database cannot be found. Not finding a protein does not show that it is absent from the sample.',
  },
  decoys: {
    title: 'Decoys',
    text: 'Decoys are reversed or shuffled protein sequences searched alongside the real ones. Matches to decoys show how many matches are wrong by chance, which is how the FDR is estimated.',
    tip: 'Leave it on “Use the database’s, else generate”: ProSE adds decoys unless the FASTA has them already.',
  },
  contaminants: {
    title: 'Contaminants (cRAP)',
    text: 'The common Repository of Adventitious Proteins: proteins that often get into samples in the lab (keratins from skin and dust, trypsin from the digestion, BSA, …). Searching them gives their spectra the right candidates to compete with, which reduces wrong assignments to proteins of your organism.',
    tip: 'Keep it on (the default). If your FASTA already holds some of the same entries, each is searched once. The result tables hide contaminants by default (filter menu); a contaminant label alone does not prove contamination (some of these proteins can be real sample proteins).',
  },
  variableMods: {
    title: 'Variable modifications',
    text: 'Chemical changes a residue may or may not carry, such as oxidised methionine, which arises during sample handling. Each one is tried on and off, so each one adds candidates: the search gets slower and can lose sensitivity. Choose the few your biology or preparation justifies.',
    tip: 'Add phosphorylation (S, T, Y) when you look for phosphopeptides, above all in phospho-enriched samples. To screen for unexpected mass shifts, use the open-search preset and check its other settings for your experiment; a mass shift alone does not identify or localize a modification.',
  },
  fixedMods: {
    title: 'Fixed modifications',
    text: 'Changes every residue of a kind carries, usually from the sample preparation: Carbamidomethyl (C) after alkylation with iodoacetamide, TMT or iTRAQ labels on K and the N-terminus.',
    tip: 'Match your protocol: without alkylation, remove Carbamidomethyl (C).',
  },
  psmFdr: {
    title: 'PSM FDR',
    text: 'The false discovery rate of the peptide-spectrum matches (PSMs) that are reported: 1 % means that about one in a hundred reported matches is expected to be wrong. Estimated from the decoys.',
    tip: '1 % is the usual choice for publication.',
  },
  proteinFdr: {
    title: 'Protein FDR',
    text: 'The false discovery rate of the reported proteins (picked-protein FDR). A protein list filtered only at the PSM level can have a much higher share of wrong proteins than the PSM FDR suggests, because wrong matches spread over many proteins.',
    tip: 'Keep 1 % for protein lists. Off reports every protein with a passing PSM, without protein-level control.',
  },
  enzyme: {
    title: 'Enzyme',
    text: 'The protease that digested the proteins; it decides where the peptides of the database are cut. Trypsin cuts after K and R, but not when the next residue is proline; Trypsin/P also cuts there (K–P, R–P).',
    tip: 'Use “unspecific cleavage” when no cleavage rule describes the peptides (e.g. immunopeptidomics). The search space grows enormously: much slower, and it can lose sensitivity. Check the peptide length and charges too.',
  },
  missedCleavages: {
    title: 'Missed cleavages',
    text: 'How many cleavage sites a peptide may contain uncut. The enzyme does not cut every site, so allowing one or two makes more candidate peptides available; too many cost sensitivity.',
    tip: '2 for trypsin is usual; more makes the search slower.',
  },
  precursorTolerance: {
    title: 'Precursor tolerance',
    text: 'How far the measured mass of a peptide (from the MS1 scan) may be from its calculated mass. Common starting windows: about 10 ppm for Orbitrap MS1 (also on the Astral), about 20 ppm for timsTOF. The window must cover the mass errors in your data.',
    tip: 'After a search, Overview › Mass accuracy recommends a window for these data. It is estimated from the matches inside the window, so it can only narrow it; when the window was too narrow or off-centre, Overview says so separately.',
  },
  fragmentTolerance: {
    title: 'Fragment tolerance',
    text: 'How far a measured fragment peak (MS2) may be from the calculated fragment mass. Common starting windows: about 10–20 ppm for high-resolution MS2 (Orbitrap, Astral), about 40 ppm for timsTOF, about 0.5 Da for ion-trap MS2.',
    tip: 'After a search, Overview › Mass accuracy shows the observed errors and recommends a window for these data (it can only narrow the one set).',
  },
  charges: {
    title: 'Charges',
    text: 'The precursor charge states searched. Tryptic peptides are mostly 2+ and 3+; the presets search 2–5 (timsTOF 2–4). A spectrum without a recorded charge is searched with every charge of the range; one whose recorded charge is outside the range is not searched.',
  },
  length: {
    title: 'Peptide length',
    text: 'The shortest and longest peptides (in residues) taken from the database. Very short peptides are rarely unique to one protein.',
  },
  calibration: {
    title: 'Calibration',
    text: 'Off by default (calibration:enabled in “All parameters”, or “Re-run with calibration” in Overview). ProSE first searches the most intense tenth of the spectra, then sets the precursor and fragment windows of the main search from the errors of its confident matches: an asymmetric window when the errors are off-centre. The window can only become narrower than the one you set, never wider, and the masses in the file are not changed. With fewer than 50 confident matches (calibration:min_psms) the pass is skipped and your windows are used.',
    tip: 'When Overview says the errors are off-centre or cut off by the window, search with a wider window first; calibration can then narrow it around the errors.',
  },
} as const satisfies Record<string, { title: string; text: string; tip?: string }>

export type HelpKey = keyof typeof HELP
