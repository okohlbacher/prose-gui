// The explanations behind the "?" of New search: what a setting does, for someone who has not run a
// search engine before, and when to change it (`tip`). Plain words; the parameter names are ProSE's.

export const HELP = {
  setup: {
    title: 'Setup',
    text: 'A setup fills in the settings that depend on the instrument: how exact its precursor (MS1) and fragment (MS2) masses are, and which model predicts its spectra. Choose the instrument that recorded the spectra; the advanced settings then rarely need changing.',
    tip: 'Save your own setup (with its database, e.g. per organism) under the setup menu.',
  },
  database: {
    title: 'Protein database (FASTA)',
    text: 'The protein sequences the spectra are matched against: usually the reference proteome of the organism the sample came from. Only peptides of these proteins can be identified.',
    tip: 'No FASTA at hand? Download the organism’s reference proteome from UniProt here. Reviewed (Swiss-Prot) entries only is smaller and faster; with unreviewed (TrEMBL) entries it is more complete.',
  },
  decoys: {
    title: 'Decoys',
    text: 'Decoys are reversed or shuffled protein sequences searched alongside the real ones. Matches to decoys show how many matches are wrong by chance, which is how the FDR is estimated.',
    tip: 'Leave it on Automatic: ProSE adds decoys unless the FASTA has them already.',
  },
  contaminants: {
    title: 'Contaminants (cRAP)',
    text: 'The common Repository of Adventitious Proteins: proteins that get into almost every sample (keratins from skin and dust, trypsin from the digestion, BSA, …). Searching them keeps their spectra from being assigned to proteins of your organism.',
    tip: 'Keep it on unless your FASTA has contaminants already. They are marked in the results.',
  },
  variableMods: {
    title: 'Variable modifications',
    text: 'Chemical changes a residue may or may not carry, such as oxidised methionine, which arises during sample handling. Each one is tried on and off, so every extra modification makes the search slower and a little less sensitive.',
    tip: 'Add phosphorylation (S, T, Y) only for phospho-enriched samples. For unknown modifications, use the open-search setup.',
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
    text: 'The false discovery rate of the reported proteins (picked-protein FDR). A protein list filtered only at the PSM level contains more wrong proteins than the PSM FDR suggests, because wrong matches spread over many proteins.',
    tip: 'Keep 1 % for protein lists. Off reports every protein with a passing PSM, without protein-level control.',
  },
  enzyme: {
    title: 'Enzyme',
    text: 'The protease that digested the proteins; it decides where the peptides of the database are cut. Trypsin cuts after K and R; Trypsin/P also before proline.',
    tip: 'Use “unspecific cleavage” for peptides that were not digested (e.g. immunopeptidomics); it is much slower.',
  },
  missedCleavages: {
    title: 'Missed cleavages',
    text: 'How many cleavage sites a peptide may contain uncut. The enzyme does not cut every site, so allowing one or two finds more peptides.',
    tip: '2 for trypsin is usual; more makes the search slower.',
  },
  precursorTolerance: {
    title: 'Precursor tolerance',
    text: 'How far the measured mass of a peptide (from the MS1 scan) may be from its calculated mass. Orbitrap and Astral MS1 are accurate to a few ppm, timsTOF to about 10–20 ppm.',
    tip: 'After a search, Overview › Mass accuracy recommends a tolerance for your instrument.',
  },
  fragmentTolerance: {
    title: 'Fragment tolerance',
    text: 'How far a measured fragment peak (MS2) may be from the calculated fragment mass. High-resolution MS2 (Orbitrap, Astral) needs about 10–20 ppm, ion-trap MS2 about 0.5 Da.',
  },
  charges: {
    title: 'Charges',
    text: 'The precursor charge states searched. Tryptic peptides are mostly 2+ and 3+.',
  },
  length: {
    title: 'Peptide length',
    text: 'The shortest and longest peptides (in residues) taken from the database. Very short peptides are rarely unique to one protein.',
  },
} as const satisfies Record<string, { title: string; text: string; tip?: string }>

export type HelpKey = keyof typeof HELP
