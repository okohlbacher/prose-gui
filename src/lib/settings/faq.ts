// The troubleshooting part of Help (FAQ): one entry per problem a user meets, written from what they see
// (`symptoms`) to what to change (`fixes`), for someone who has not run a search engine before. Plain words,
// British spelling, the app's own button and setting names, ProSE's parameter names where only "All parameters"
// has them.
//
// Where the entries come from: a study of 2,569 support threads and 439 vendor and engine help pages (the
// discussion paper "Why users get search engines wrong", its top 10 issues and its silent failure patterns),
// three independent reviews of the earlier Help against it, and the checks of this app. Every entry was checked
// against the code: what a check looks at, when it fires and what its buttons do.
//
// How the app links here: every check, diagnosis cause, tolerance finding and check of a finished search has a
// stable id (`search/checks.ts`, `search/spectra.ts`, `search/database.ts`, `search/chemistry.ts`,
// `results/diagnosis.ts`, `results/tolerance.ts`, `results/sanity.ts`, the input warnings of
// `results/overview.ts`, the notes of `results/chemistry.ts` and the fractions note of `search/scope.ts`). `checks` lists the ids that should open an entry, and `faqFor(id)` finds it; an entry's
// `id` is the element id of its section on the Help page (`openHelp`). The transient states `adding` and
// `database-counting` (Start waits while files are added or the database is counted) have no entry.
//
// What the entries must not claim (the reviews found these overclaims in drafts):
// - The checks before Start read mzML (.mzML, .mzML.gz) files only, by their flags, from up to the first 1,000 MS2
//   spectra (within the first 64 MiB): a file flagged centroid is "flagged", not verified. For Thermo .raw, Bruker
//   .d and mzPeak inputs, only no MS2, profile spectra and charges outside the range are reported, after the search.
// - Calibration (`calibration:enabled`) never widens a window: a first pass on the most intense spectra sets an
//   asymmetric window from the errors of its confident PSMs, at most as wide as the one set, and it is skipped
//   with too few of them (`calibration:min_psms`). It does not correct the masses in the file.
// - "Generate" decoys removes the database's own decoys first and makes new ones; it does not double them.
// - The absence of a warning does not show that the data or settings are right.
// - prose-gui identifies peptides and proteins from DDA spectra. DIA analysis, quantification (LFQ, TMT reporter
//   ions, SILAC ratios), statistics and vendor conversion are elsewhere; `outside` says where.

export type FaqEntry = {
  /** Stable, 'faq-…' kebab-case: the element id on the Help page. */
  id: string
  group: 'few-ids' | 'before' | 'inputs' | 'database' | 'fdr' | 'results' | 'app'
  /** As a user would ask it. */
  question: string
  /** What the user sees, one or two sentences. */
  symptoms: string
  /** Likely causes, most likely first. */
  causes: string[]
  /** Concrete steps in prose-gui, ProSE or msconvert terms. */
  fixes: string[]
  /** The ids of the app's checks, diagnosis causes and findings that link here. */
  checks?: string[]
  /** When the fix lies outside prose-gui: where to go. */
  outside?: string
}

/** The groups, in display order. */
export const FAQ_GROUPS: { id: FaqEntry['group']; title: string }[] = [
  { id: 'few-ids', title: 'Few or no identifications' },
  { id: 'before', title: 'The search will not start' },
  { id: 'inputs', title: 'Spectrum files and conversion' },
  { id: 'database', title: 'The protein database' },
  { id: 'fdr', title: 'Decoys, FDR and what the numbers mean' },
  { id: 'results', title: 'Checks of a finished search' },
  { id: 'app', title: 'Running, reproducing and reporting' },
]

export const FAQ: FaqEntry[] = [
  // ---- Few or no identifications ----
  {
    id: 'faq-few-ids',
    group: 'few-ids',
    question: 'Why did I get so few identifications, or none?',
    symptoms:
      'Overview shows “Why so few identifications?”: a file identifies a smaller share of its MS2 spectra than a search of its kind usually does, or far fewer than the other files of the batch. Or the tables are nearly empty.',
    causes: [
      'The spectra cannot be searched as they are: no MS2 spectra, profile (not centroided) MS2 spectra, DIA data, or precursor charges missing or outside the charge range.',
      'The search does not match the sample chemistry: a wrong or missing alkylation, a missing label (TMT, iTRAQ, SILAC), the wrong enzyme.',
      'Too many variable modifications: each adds candidates, which can lower the identifications at a fixed FDR.',
      'The mass tolerances do not fit the data: errors off-centre or cut off by the window, or a ppm fragment tolerance for ion-trap spectra.',
      'The database does not hold the sample’s proteins (wrong organism, an incomplete proteome), so contaminants dominate.',
      'Too few matches for the statistics: a small test file, or Percolator could not train and fell back to a single score.',
      'The problem is upstream of the software: little sample, a short gradient, poor fragmentation or MS2 triggering.',
    ],
    fixes: [
      'Read the causes the card lists, strongest first, and follow each one’s entry here; their re-run buttons open New search with the change marked.',
      'Look at Overview › Files (MS2 spectra, Target PSMs, Percolator, the marks under each file name), Mass accuracy, Sample chemistry and Checks of the search before you change anything.',
      'Change one thing at a time and compare at the same FDR. Raising the FDR only admits more uncertain matches; widening every tolerance or adding modifications can lower the identifications at a fixed FDR, because more wrong candidates compete.',
      'When the card lists no cause, the search found nothing it can name. Check the sample preparation (alkylation, labels, enzyme) and the organism of the database against your protocol, then compare the run with a good run of the same instrument.',
    ],
    checks: ['low-id-rate'],
    outside:
      'If the files and settings are right and a good run of the same setup also identifies well, the cause is in the sample or the acquisition: discuss it with your mass spectrometry facility.',
  },
  {
    id: 'faq-sample-chemistry',
    group: 'few-ids',
    question: 'Does my search match how the sample was prepared?',
    symptoms:
      'The SDRF (the table describing the experiment’s samples, see The settings) lists modifications the search does not include, or Overview › Sample chemistry says few peptides have a cysteine, many have a missed cleavage or a non-tryptic end. Often there is no message at all, only fewer identifications than expected.',
    causes: [
      'The fixed modification on cysteine does not match the alkylation: the presets assume iodoacetamide (Carbamidomethyl (C)); acrylamide gives Propionamide (C), N-ethylmaleimide gives Nethylmaleimide (C), and a sample that was not alkylated needs none.',
      'A modification the sample carries is missing: a label, a chemical modification of the protocol, or the phosphorylation of an enriched sample.',
      'The enzyme or its specificity is wrong (a different protease, Trypsin against Trypsin/P, a semi-specific digest).',
      'The SDRF itself is wrong or out of date.',
    ],
    fixes: [
      'Ask for, or look up, the protocol: alkylation agent, enzyme, labels and any enrichment. Set them under Search settings: Fixed modifications and Enzyme are under “Advanced settings”, Variable modifications above them.',
      'Make chemistry that every residue of a kind carries fixed (alkylation, a complete label); make variable only what may or may not be there (oxidation, phosphorylation).',
      'If the SDRF is right, add exactly the modifications it lists, fixed or variable as its MT= field says; otherwise correct the SDRF.',
      'After the search, compare Sample chemistry: the share of peptides with a cysteine against the share expected from the proteins, and the missed cleavages and non-tryptic ends.',
      'To find an unexpected mass shift, search one file with the “Open search · ±500 Da” preset. The preset sets its own chemistry (a tryptic digest, Carbamidomethyl (C) fixed): restore the enzyme and labels of your sample after choosing it, and read each shift relative to the fixed modifications set. To test the alkylation, remove the fixed cysteine modification: alkylated cysteines then show as +57 Da (iodoacetamide). Add the modification that explains the main shift and search again normally.',
    ],
    checks: ['sdrf-modifications', 'chemistry-cysteine', 'chemistry-missed-cleavages', 'chemistry-non-specific'],
  },
  {
    id: 'faq-isobaric-labels',
    group: 'few-ids',
    question: 'Why are my TMT, iTRAQ or SILAC peptides missing?',
    symptoms:
      'New search says the SDRF labels the samples with TMT or iTRAQ but the search has no label modification, or Sample chemistry reports the label on only part of the peptides with a K.',
    causes: [
      'No label modification is set: a labelled peptide has a different mass, so without its label it cannot be matched.',
      'The label is set on only one site: TMT and iTRAQ label K and the peptide N-terminus (“N-term”), not only the protein N-terminus.',
      'The wrong reagent: TMT 6- to 11-plex share the mass of TMT6plex, while TMT0 (“TMT”), TMT2plex and TMTpro (16- and 18-plex) each have their own; iTRAQ 4-plex and 8-plex differ.',
      'For SILAC, heavy K and heavy R are different modifications (e.g. Label:13C(6)15N(2) (K) and Label:13C(6)15N(4) (R)); one rule for both is wrong.',
      'The labelling of the sample was incomplete.',
    ],
    fixes: [
      'For TMT or iTRAQ, add the reagent’s label as a fixed modification on K and on N-term (e.g. TMT6plex (K) and TMT6plex (N-term)).',
      'Make a label variable only to measure incomplete labelling, deliberately.',
      'For SILAC, add the heavy forms as variable modifications, each on its own residue, and keep the light form unmodified.',
      'To measure how completely the samples are labelled, search once with the label as a variable modification: Sample chemistry then shows “Label on K” (the share of K-containing peptides found labelled; close to 100 % for good labelling). With the label fixed it shows no such figure, and it does not judge the N-terminus or SILAC labels.',
    ],
    checks: ['sdrf-label', 'chemistry-label'],
    outside:
      'prose-gui identifies the labelled peptides; it does not quantify reporter ions or SILAC pairs. Reporter extraction, SPS-MS3, impurity correction and ratios belong to a quantification tool such as OpenMS IsobaricAnalyzer or quantms, then a statistics tool such as MSstats.',
  },
  {
    id: 'faq-mass-errors',
    group: 'few-ids',
    question: 'My mass errors are off-centre, or pile up at the edge of the window. What do I change?',
    symptoms:
      'Overview says the precursor or fragment errors are off-centre (the median is more than a third of the window away from zero), that many passing PSMs lie in the outer tenth of the precursor window, or that the fragment errors fill the window.',
    causes: [
      'The instrument was not well calibrated for this run, or its calibration drifted during a batch.',
      'Calibration was lost in conversion (for example a Waters lockmass correction or a Bruker precursor calibration not applied).',
      'The window is too narrow for the instrument (Orbitrap windows on TOF data, a preset of another instrument).',
      'The unit is wrong: ppm where Da was meant, or the other way round.',
    ],
    fixes: [
      'Use the offered wider re-run first (e.g. “Re-run with ±50 ppm”, a doubled Da window, or “Re-run with … ppm fragments”): matches whose errors lay outside the old window can only come back with a wider one. If the window is already wider than that, widen it by hand under “Advanced settings” until the errors fit inside it.',
      'Then look at Overview › Mass accuracy of the new search: the errors should form one complete peak inside the window. Compare the identifications at the same FDR.',
      'Never narrow the window while an offset or a pile-up at the edge is reported: that loses more matches.',
      '“Re-run with calibration” (offered for an offset while nothing is cut off) can only make the windows narrower than the ones you set, never wider: use it after the window is wide enough, not instead of widening (see Calibration under The settings).',
      'When the errors drift a lot within or between runs, fix the calibration at the instrument or in the conversion rather than searching with a very wide window for good.',
    ],
    checks: ['tolerance-offset', 'tolerance-edge'],
    outside: 'Lockmass and recalibration of the raw data are part of the vendor software or the converter (ProteoWizard msconvert), not of prose-gui.',
  },
  {
    id: 'faq-tolerance-too-wide',
    group: 'few-ids',
    question: 'Can a tolerance be too wide?',
    symptoms: 'Overview says the precursor or fragment window is more than twice what the errors need, and offers a re-run with the recommended window.',
    causes: [
      'The window was set wider than the instrument needs (a cautious default, the preset of a less accurate instrument).',
      'An open search, whose ±500 Da precursor window is wide on purpose (its preset does not show this finding).',
    ],
    fixes: [
      'Use the offered “Re-run with ±… ppm” (or “… ppm fragments”). A wider window lets more wrong candidates compete, including decoys, which can make targets and decoys separate less well and lower the identifications at the same FDR.',
      'The recommendation comes from the passing PSMs of this search, inside its window: it says what these data need, not a property of the instrument for every run. Check it again after the re-run.',
      'This finding is only given when the errors are centred and nothing piles up at the edge; if either is reported, widen first (see the entry on off-centre errors).',
    ],
    checks: ['tolerance-too-wide'],
  },
  {
    id: 'faq-iontrap-ppm',
    group: 'few-ids',
    question: 'Why does New search warn about ion-trap MS2 and a ppm fragment tolerance?',
    symptoms: 'A warning that files were measured with ion-trap MS2 (low-resolution fragments) while the fragment tolerance is in ppm, with the button “Use 0.5 Da”.',
    causes: [
      'The fragments were measured in the ion trap, which is searched with a fragment tolerance of about 0.5 Da, but the tolerance is a high-resolution one of a few ppm, so almost no fragment matches.',
      'A hybrid instrument (LTQ Orbitrap, Orbitrap Fusion) chosen by its name: it can record MS2 in the ion trap or in the Orbitrap; the analyzer of the MS2 scans decides.',
    ],
    fixes: [
      'Click “Use 0.5 Da”, or choose the preset “Ion trap CID · tryptic”, which also expects a lower identification rate.',
      'Keep the precursor tolerance as it is when MS1 was measured in the Orbitrap (about 10 ppm). For a stand-alone ion trap (LTQ, Velos without Orbitrap), MS1 is low-resolution too: set the precursor tolerance in Da, as wide as the acquisition needs (often 1 to 2 Da).',
      'Do not use the open-search preset on ion-trap MS2: its fragment tolerance is a high-resolution one.',
      'The check reads the analyzer from mzML files; for .raw and .d inputs check the method yourself.',
    ],
    checks: ['iontrap-ppm'],
  },
  {
    id: 'faq-charge-states',
    group: 'few-ids',
    question: 'Why do my spectra have no precursor charge, or why were some not searched because of their charge?',
    symptoms:
      'New search notes that most MS2 spectra have no precursor charge; or, after the search, Overview says a share of the MS2 spectra were not searched because their recorded charge is outside the range, with “Re-run with charges 1–6”.',
    causes: [
      'The conversion did not keep the charges: a timsTOF file converted to mzML without its PASEF precursors looks like this.',
      'The instrument did not determine a charge (older ion-trap data, low-intensity precursors).',
      'The charge range is too narrow for the sample (the presets search 2–5, the timsTOF preset 2–4).',
    ],
    fixes: [
      'The two cases need different fixes. A spectrum without a charge is searched with every charge of the range: that costs time and lowers the identifications at a fixed FDR. A spectrum with a recorded charge outside the range is not searched at all.',
      'For missing charges, add the original Bruker timsTOF .d or Thermo .raw instead of the converted file, or convert again with a current converter that keeps the precursors.',
      'For charges outside the range, use “Re-run with charges 1–6”, or set Charges under “Advanced settings” to the range the data need.',
      'Do not widen the charge range far beyond what the sample contains: every extra charge adds candidates.',
    ],
    checks: ['no-charge', 'charge'],
  },
  {
    id: 'faq-percolator-small-run',
    group: 'few-ids',
    question: 'Why was Percolator skipped, and can I trust the FDR of a small search?',
    symptoms:
      'Overview › Files shows Percolator “Skipped” or a warning for some files, the diagnosis says Percolator could not train, or that the search has only a few hundred passing PSMs.',
    causes: [
      'Too few confident matches for Percolator to learn from, so it fell back to a single score, which passes fewer PSMs.',
      'A small input: a short test run, a thin first or last fraction, a tiny database.',
      'An upstream problem that leaves few good matches (any of the causes of few identifications).',
    ],
    fixes: [
      'Read the full reason in Overview › Files › Percolator.',
      'Fix the cause of the few matches first (spectra, chemistry, tolerances, database); a skipped Percolator is a consequence, not an installation problem: Percolator is part of ProSE.',
      'Search related files (the fractions or replicates of one experiment) together: in a search of several files, ProSE trains one shared model for the files too small for their own.',
      'With few PSMs the target-decoy FDR is coarse: Percolator estimates the FDR at a cutoff as (decoys + 1) / targets, so 80 PSMs cannot reach 1 %. Do not raise the FDR to get more training data, and do not report a small search’s list as if it had the precision of a large one.',
    ],
    checks: ['percolator', 'small-run'],
  },

  // ---- The search will not start ----
  {
    id: 'faq-settings-rejected',
    group: 'before',
    question: 'Why does New search refuse a setting or a modification?',
    symptoms: 'The plan line at the bottom says a range is inverted or out of bounds, that a PSM FDR above 0 % is needed, or that a modification is not known; Start is disabled.',
    causes: [
      'A range with its lower value above its upper one, or a value outside what ProSE accepts.',
      'A PSM FDR of 0 while the search has decoys: the FDR needs a cutoff.',
      'A modification name that ProSE does not know: a typo, an old name, or a modification that is not in its list (UniMod names, with the site in brackets).',
    ],
    fixes: [
      'Correct the value the message names, in Search settings or in the “All parameters” dialog.',
      'Set the PSM FDR to 1 %, the usual choice. Switching the decoys off to get past this leaves the search without any FDR.',
      'Choose the modification from the list, with the right site: “N-term” is the peptide N-terminus, “Protein N-term” the protein’s.',
    ],
    checks: ['range-inverted', 'range-outside', 'psm-fdr', 'unknown-modification'],
    outside: 'A modification that is not in the list (a custom chemical) cannot be set in prose-gui; it needs ProSE or OpenMS from the command line with a custom modification definition. Crosslinks join two peptides and need a crosslink search engine (e.g. OpenPepXL); a modification cannot describe them.',
  },
  {
    id: 'faq-sdrf-design',
    group: 'before',
    question: 'Why does the SDRF or the design table stop the search?',
    symptoms: 'The plan line names a problem of the SDRF (data files it lists that are not found) or a design cell that is not a whole number of at least 1.',
    causes: [
      'The SDRF names data files that are not where the app looked: moved, renamed, converted to another name, or not downloaded yet.',
      'A design cell (fraction, replicate) holds text or a 0.',
      'The SDRF lists a file the app cannot read.',
    ],
    fixes: [
      'In the SDRF panel, use “Locate folder…” for the folder that holds the files, or “Locate…” for each missing file. For a PRIDE dataset, “Download missing…” fetches them (the PRIDE project is taken from the SDRF or its file name; otherwise type its PXD accession).',
      'For a file the app cannot read, convert it to mzML and locate it again.',
      'Tick “Search without them” only when you mean to leave those files out; the search then describes a different experiment than the SDRF.',
      'Correct the design cell to a whole number of at least 1, or empty it.',
      'An SDRF does not set the search chemistry for you: check its modifications and labels (see the entries on sample chemistry and labels).',
    ],
    checks: ['sdrf', 'design-cell'],
  },

  // ---- Spectrum files and conversion ----
  {
    id: 'faq-spectrum-files',
    group: 'inputs',
    question: 'Which spectrum files can I add, and why is one refused?',
    symptoms: 'Start says to add files, or that a file cannot be searched: not an mzML, incomplete (it ends before its closing tag), not gzip-compressed though named .gz, or with no spectra.',
    causes: [
      'A format the app does not read: it reads mzML (.mzML, .mzML.gz), mzPeak, Thermo .raw and Bruker timsTOF .d folders.',
      'A file cut off by an interrupted copy, download or sync folder.',
      'A Bruker .d folder that is incomplete or was chosen by the wrong file inside it.',
      'A renamed file: changing the extension does not convert a file.',
    ],
    fixes: [
      'Add an mzML, mzPeak, Thermo .raw or Bruker timsTOF .d. For a .d, choose the folder (or its analysis.tdf) and keep the whole folder together.',
      'Copy or download the file again to a local folder, or convert it again, then add it again.',
      'Remove a file that cannot be searched to start with the others, and note that the experiment then has one fewer file.',
    ],
    checks: ['no-files', 'file-problem'],
    outside: 'Other vendor formats (SCIEX .wiff, Waters .raw, Agilent .d) need conversion to mzML first, e.g. with ProteoWizard msconvert, whose vendor readers run on Windows.',
  },
  {
    id: 'faq-profile-spectra',
    group: 'inputs',
    question: 'What does “MS2 spectra flagged as profile” mean, and how do I fix it?',
    symptoms:
      'Start is blocked because the MS2 spectra of a file are flagged as profile, with “Search anyway”; or after the search Overview says a share of the MS2 spectra were in profile mode.',
    causes: [
      'The spectra were not centroided (peak-picked) when converted. A profile spectrum stores each peak as many points of a curve; ProSE expects one point per peak and identifies few peptides from profile data.',
      'Peak picking was applied to MS1 only, or was not the first filter in msconvert (a filter before it makes vendor peak picking fail).',
      'The flag is wrong: a file can be flagged centroid while its peaks are profile, or the other way round. The check before Start reads the flags only.',
    ],
    fixes: [
      'Convert again from the vendor file with peak picking as the first filter for all MS levels: msconvert input.raw --mzML --filter "peakPicking vendor msLevel=1-"',
      'For an mzML that is already converted, vendor peak picking is no longer possible: convert again from the raw file with vendor peak picking where you can. For high-resolution (Orbitrap, TOF) profile mzML, OpenMS PeakPickerHiRes is an option; low-resolution or ion-mobility data need a workflow made for them.',
      'If the original Thermo .raw or Bruker timsTOF .d is at hand, add it instead and compare.',
      'Add the new file and check that New search no longer flags it. “Search anyway” does not centroid anything: it searches the profile spectra as they are, and is remembered for that file on this computer.',
    ],
    checks: ['profile-ms2', 'profile'],
    outside: 'Filter chains and vendor-specific options of msconvert are documented by ProteoWizard (proteowizard.sourceforge.io).',
  },
  {
    id: 'faq-no-ms2',
    group: 'inputs',
    question: 'Why does a file have no MS2 spectra?',
    symptoms: 'Start is blocked because a file has no MS2 spectra (MS1 only?), or Overview marks a file “no MS2 spectra” and it has no identifications.',
    causes: [
      'The acquisition recorded MS1 only, or it is a targeted method (SIM, SRM) stored as chromatograms.',
      'The conversion removed the MS2 spectra (an MS-level filter) or kept only part of the file.',
      'Waters MSe or lockmass functions, or other scans that are not DDA MS2 spectra.',
    ],
    fixes: [
      'Check the acquisition method: a DDA run has MS2 spectra.',
      'Convert again without filters that remove MS2, and add the file again.',
      'If the file truly has no MS2 spectra, remove it: nothing in it can be identified. “Search anyway” does not change this.',
    ],
    checks: ['no-ms2'],
    outside: 'SRM/MRM and SIM data are analysed with targeted tools such as Skyline, not with a database search.',
  },
  {
    id: 'faq-dia-input',
    group: 'inputs',
    question: 'Can I search DIA, SWATH, MSe or diaPASEF data here?',
    symptoms: 'New search stops with a red flag: the MS2 spectra cycle through the same isolation windows, as DIA does (PRM data can be searched anyway). A DIA file searched anyway gives odd q-values and few, unreliable identifications.',
    causes: [
      'The data are DIA (data-independent acquisition: SWATH, diaPASEF, wide-window DIA, MSe): each MS2 spectrum holds the fragments of many peptides, which a DDA (data-dependent acquisition) search scores as if they came from one.',
      'A targeted PRM (parallel reaction monitoring) run: it repeats its isolation windows too, and is fine to search.',
    ],
    fixes: [
      'Check the acquisition method. ProSE searches DDA spectra, one precursor at a time.',
      'For DIA data use a DIA tool; do not report a ProSE result of DIA data as a DIA analysis.',
      'For PRM, continue: the warning does not stop the search.',
      'For timsTOF data, ddaPASEF is DDA and searchable; diaPASEF is DIA.',
    ],
    checks: ['dia-suspected'],
    outside: 'DIA data need a DIA search engine, such as DIA-NN or OpenSWATH; their documentation covers spectral libraries and DIA settings.',
  },
  {
    id: 'faq-conversion',
    group: 'inputs',
    question: 'The app reads .raw and .d directly: when do I still convert, and how do I convert well?',
    symptoms: 'A converted file identifies far fewer spectra than the original, its activation (HCD, CID, ETD) looks wrong in the line “MS2 spectra by their flags” of the Spectra card, or several of the checks of this group fire for it.',
    causes: [
      'Peak picking missing or not first in the filter chain (profile spectra).',
      'Precursor information lost: no charges (timsTOF converted without PASEF precursors), precursor m/z on the wrong isotope or rounded.',
      'The activation written wrongly (e.g. HCD written as ECD and CID): ProSE adds c and z+1 ions only for spectra recorded as electron-activated (ions:by_activation), so a wrong activation means the wrong ion series.',
      'Calibration not applied (Waters lockmass), or retention times in the wrong unit.',
    ],
    fixes: [
      'Prefer the original Thermo .raw or Bruker timsTOF .d where you have it: that avoids what an extra conversion step can lose. Do not convert timsTOF .d files to mzML for a DDA search.',
      'For other vendors convert with a current msconvert, peakPicking first: msconvert input --mzML --filter "peakPicking vendor msLevel=1-". Keep 64-bit m/z precision.',
      'Compare the line “MS2 spectra by their flags” of the Spectra card (centroid or profile, activation, analyzer; a file that differs from the others is marked in its Spectra column) with the acquisition method.',
      'For verified ETD-type data without activation information, set ions:add_c_ions and ions:add_zp1_ions in the “All parameters” dialog.',
    ],
    checks: [],
    outside: 'Vendor reader installation, Waters lockmass and SCIEX .wiff/.wiff2 options are covered by ProteoWizard and the vendors; prose-gui only checks the result.',
  },

  // ---- The protein database ----
  {
    id: 'faq-fasta-problem',
    group: 'database',
    question: 'Why is my FASTA file refused?',
    symptoms:
      'Start says to choose a FASTA database, that it cannot be read, or names a problem: no entries, an entry without an accession or a sequence, characters that are not amino acids, an accession listed twice with different sequences, a protein longer than ProSE can index.',
    causes: [
      'The wrong file, or a download that was interrupted (e.g. a web page saved instead of the FASTA).',
      'A hand-made or merged FASTA with empty entries, a missing “>” on the first line, or two different sequences under one accession.',
      'Very long sequences (e.g. titin isoforms of some databases, or concatenated sequences).',
    ],
    fixes: [
      'Choose a protein FASTA (.fasta, .fa, .faa), or download the organism’s reference proteome from UniProt from the database card.',
      'In a merged FASTA give each different sequence its own accession; the same entry listed twice is fine (the app says so and searches it once).',
      'Split only the proteins the message names into shorter pieces.',
      'Headers that are not in UniProt style can still be searched, but gene names and organisms may then be missing from the results and from the database summary.',
    ],
    checks: ['no-database', 'database-error', 'database-problem'],
  },
  {
    id: 'faq-organism-database',
    group: 'database',
    question: 'Is this the right protein database for my sample?',
    symptoms: 'New search warns that the SDRF names an organism the database’s entries do not have, or the results hold mainly contaminants and few proteins of the organism.',
    causes: [
      'A database of another organism, or of a related one with different sequences.',
      'An incomplete proteome: Swiss-Prot (reviewed) only, for an organism where most proteins are unreviewed.',
      'A sample of several organisms (host and pathogen, xenograft, spike-ins) searched against one.',
      'The SDRF names the organism wrongly.',
    ],
    fixes: [
      'Compare the database summary on the database card (main organism, number of entries, isoforms, contaminants, decoys) with the sample.',
      'Download the organism’s reference proteome from UniProt; for poorly studied organisms take all entries, not only the reviewed ones.',
      'For a sample of several organisms, use one FASTA with all of them; the app does not warn about a FASTA of several organisms by itself.',
      'Correct the SDRF if it is wrong. The check can only compare organisms the FASTA headers name (OS=): no warning does not show that the database is right.',
    ],
    checks: ['organism-mismatch'],
  },
  {
    id: 'faq-contaminants',
    group: 'database',
    question: 'Why do keratins and other contaminants dominate my results?',
    symptoms: 'The diagnosis says a large share of the passing PSMs are contaminants (keratins, albumin and the like; trypsin not counted).',
    causes: [
      'The database does not match the sample, so only the contaminants find their sequences.',
      'There was little of the sample’s protein, so contaminants make up much of what was measured.',
      'The sample is contaminated (skin keratins, serum albumin).',
      'Some proteins of the contaminant list are genuine sample proteins (e.g. keratins of skin samples, albumin of serum).',
    ],
    fixes: [
      'Check the database first (see the entry on the right protein database).',
      'Show the contaminants in the tables (they are hidden by default: the filter menu’s “Hide contaminants”) and look at their PSMs and accessions.',
      'Keep Contaminants (cRAP) on: searching them gives their spectra the right candidates, so they are not assigned wrongly to proteins of your organism. Hiding them changes only what the tables show.',
    ],
    checks: ['contaminants'],
    outside: 'Contamination during sample preparation is a wet-lab question for your facility.',
  },

  // ---- Decoys, FDR and what the numbers mean ----
  {
    id: 'faq-decoys-fdr',
    group: 'fdr',
    question: 'Why does the app warn about the decoys, or say all q-values are 0?',
    symptoms:
      'Before the search: the database has decoys of its own while Decoys is set to Generate. After it: the search reports no decoy proteins, all PSMs of a file have q-value 0 (a q-value is the lowest FDR at which a PSM would still be reported), or a file or the whole search is marked “no FDR”.',
    causes: [
      'Decoys switched off (“None (no FDR)”): the search then has no FDR at all.',
      'The database’s decoys carry a marker the search did not recognise, so they were treated as targets.',
      'A database with far fewer or far more decoys than targets: “Use the database’s, else generate” reuses a database’s decoys only at 0.5 to 2 per target and refuses others.',
      'A file marked “no FDR” in Overview › Files: its PSM FDR was not applied, so its PSMs have no q-value. The current ProSE applies a conservative estimate (1 / T for T target PSMs) even when no PSM of a file matched a decoy; a result of an earlier ProSE can show “no FDR” for such a file.',
    ],
    fixes: [
      'Leave Decoys on “Use the database’s, else generate”: ProSE then reuses decoys it recognises (common markers such as rev_, DECOY_, as prefix or suffix) or makes its own.',
      'With Generate, ProSE removes the database’s recognised decoys and makes new ones from the targets: either way each target gets one decoy. To keep the database’s own (e.g. when you must report how they were made), click “Use the database’s decoys” in the warning, which sets Decoys back to “Use the database’s, else generate”.',
      'When all q-values of a file are 0, check before you trust its FDR. Without Percolator a short list can give this legitimately (ProSE’s q-values are then decoys ÷ targets, 0 above the best decoy). Otherwise look at the decoy count of the database summary; if the decoys were not recognised, use a target-only FASTA and let ProSE generate the decoys, then search again.',
      'Never report the results of a search without decoys, or of a file marked “no FDR”, as FDR-controlled.',
    ],
    checks: ['decoys-twice', 'no-decoys', 'all-q-zero'],
  },
  {
    id: 'faq-fdr-levels',
    group: 'fdr',
    question: 'Does 1 % FDR mean each protein or peptide is right?',
    symptoms: 'A count, a filtered subset (e.g. the phosphopeptides) or a single protein is read as “1 % wrong”, or counts differ between tools or searches.',
    causes: [
      'The FDR is a property of a list, not of one match: at 1 % PSM FDR about one in a hundred reported PSMs is expected to be wrong, and you cannot tell which.',
      'The levels differ: ProSE controls PSMs (PSM FDR) and proteins (picked-protein FDR); peptide counts come from the PSMs and are not FDR-controlled at the peptide level.',
      'A subset is not controlled separately: modified peptides or proteins with one peptide can have a much higher share of wrong matches than the whole list.',
      'A protein group is one result: proteins that share all their identified peptides cannot be told apart, so the group’s evidence is not evidence for each protein in it.',
      'Counts of different searches or tools differ in FDR level, cutoff, database and settings.',
    ],
    fixes: [
      'Report PSMs at the PSM FDR and proteins (protein groups) at the protein FDR; keep the protein FDR on for protein lists.',
      'Do not claim 1 % FDR for a subset you selected afterwards; say what was controlled.',
      'For a claim about one protein, look at its PSMs and spectra, and at whether its peptides are shared with other proteins.',
      'Compare counts only at the same level, cutoff, database and settings.',
      'A modification’s position is where the search placed it, without a site-localisation score.',
    ],
    checks: [],
  },
  {
    id: 'faq-fdr-scope',
    group: 'fdr',
    question: 'Should fractions and replicates be searched together, and what is the FDR computed over?',
    symptoms:
      'The line under the design table states the scope of the FDR, or notes that the files are fractions of one replicate per condition; protein counts change when the same files are split over several searches.',
    causes: [
      'ProSE estimates the PSM FDR per file (with Percolator from its q-values; without it also per fragment-charge group, FDR:PSM_groups) and the protein FDR once over all files of the search.',
      'Separate searches each control their own protein list; putting their lists together does not keep the 1 %.',
      'Fractions are parts of one sample, not replicates: a design with one replicate per condition has none to compare the conditions on.',
    ],
    fixes: [
      'Search the files of one experiment together, so the protein FDR covers the whole experiment.',
      'In the design table, give the fractions of one sample the same sample and replicate and their own fraction numbers; give biological replicates their own replicate numbers.',
      'Do not union protein lists of separate searches and report them at the original FDR.',
    ],
    checks: ['fractions-no-replicates'],
    outside: 'Whether a design supports a comparison of conditions is a question of the statistics (e.g. MSstats), downstream of the identification.',
  },

  // ---- Checks of a finished search ----
  {
    id: 'faq-runs-missing',
    group: 'results',
    question: 'Why is a run missing, or why do the spectrum counts not add up?',
    symptoms:
      'Checks of the search says fewer runs came back than files were searched, or that ProSE counted more MS2 spectra in a file than its header lists spectra in all.',
    causes: [
      'A file failed in the search: its Status in Overview › Files and the log say why.',
      'The file changed after it was added (overwritten, still being copied or converted).',
      'The file numbers its spectra twice or was put together from parts.',
      'Two inputs with the same name.',
    ],
    fixes: [
      'Do not interpret the results until every input has its run.',
      'Look at the file’s Status, restore an unchanged local copy, and do not change inputs while a search runs.',
      'Search the affected file alone to see whether it fails by itself, then search the experiment again together.',
      'If unchanged inputs still give the mismatch, report it with the search record and the log (see the entry on reproducing and reporting).',
      'No warning does not prove that every spectrum was searched: the check only sees more spectra than the header lists, not fewer.',
    ],
    checks: ['runs-missing', 'spectra-mismatch'],
  },
  {
    id: 'faq-isotope-share',
    group: 'results',
    question: 'Why do so many matches use an isotope peak instead of the monoisotopic one?',
    symptoms: 'Checks of the search says a large share (above a quarter) of the passing PSMs match an isotope peak, not the monoisotopic one. (The check needs at least 100 passing PSMs.)',
    causes: [
      'The instrument or the converter picked a 13C isotope peak as the precursor instead of the monoisotopic one.',
      'The precursor m/z was rounded or taken from the wrong scan in conversion.',
    ],
    fixes: [
      'ProSE searches isotope errors of −1 to +1 by default (precursor:isotope_error_min/max), so some matches of this kind are normal; a large share means the precursor masses of the file are off.',
      'Convert again with a current converter and monoisotopic precursor correction, or add the original .raw or .d.',
      'Do not hide it by widening the precursor tolerance: that adds wrong candidates without fixing the masses.',
    ],
    checks: ['isotope-share'],
  },
  {
    id: 'faq-rt-unit',
    group: 'results',
    question: 'Why do the retention times look impossible?',
    symptoms: 'Checks of the search says the identifications of a file end at a retention time that fits no LC run (beyond 10 hours, or under 2 minutes for a long file).',
    causes: [
      'Minutes read as seconds, or milliseconds as seconds, because the unit of the retention times is missing or wrong in the file.',
      'An unusual acquisition (the check uses rough bounds).',
    ],
    fixes: [
      'Compare with the length of the gradient you ran.',
      'Convert again so the file states the right unit, then search again. Rescaling the exported times alone leaves the spectra and the retention-time feature (PeptDeep’s prediction) of the search wrong.',
    ],
    checks: ['rt-unit'],
  },
  {
    id: 'faq-parameter-echo',
    group: 'results',
    question: 'Why did ProSE use a different setting from the one I set?',
    symptoms: 'Checks of the search says “ProSE used … = …, not … as set”; “What ProSE used” lists the setting in amber.',
    causes: [
      'ProSE changed or dropped a setting that does not fit the others (e.g. an FDR without decoys).',
      'A setting written in a way ProSE reads differently (a modification name, a list).',
      'A difference of form only (the same value written another way), or a fault of the app or ProSE.',
    ],
    fixes: [
      'Open “What ProSE used” under Checks of the search and compare the setting with the one in New search (History › Settings opens the search’s settings there).',
      'Correct the setting, search again, and check that the difference is gone.',
      'If it stays and changes the meaning, report it with the search record (see the entry on reproducing and reporting).',
    ],
    checks: ['parameter-echo'],
  },
  {
    id: 'faq-open-search',
    group: 'results',
    question: 'What does a mass shift of an open search tell me?',
    symptoms: 'The open-search preset found PSMs with mass shifts, shown under Mass shifts (open search), and a shift looks like a modification.',
    causes: [
      'A real modification, or one from the sample handling (e.g. alkylation of another residue).',
      'A setting of the search that does not match the sample (a missing fixed modification shows as a frequent shift).',
      'An isotope or calibration error, which also shows as a shift.',
      'Several modifications with the same mass.',
    ],
    fixes: [
      'Use the open search to discover frequent shifts, on high-resolution MS2 only.',
      'Follow a frequent shift with a normal search that adds the modification it suggests, and compare.',
      'A mass shift is a mass difference: it neither identifies a modification nor shows where it sits.',
    ],
    checks: [],
    outside: 'Site localisation of modifications needs a localisation tool or score, which ProSE does not provide.',
  },

  // ---- Running, reproducing and reporting ----
  {
    id: 'faq-engine-resources',
    group: 'app',
    question: 'ProSE will not run, is very slow, or runs out of memory: what can I do?',
    symptoms: 'New search says ProSE cannot be run; or a search takes very long, fails with a memory error, or the computer becomes unresponsive.',
    causes: [
      'The ProSE tool of the app is missing or replaced (PROSE_BIN set to a file that does not exist).',
      'A search space that is too large: many variable modifications (each is tried on and off; beyond about four, a search gets much slower and often less sensitive), an unspecific enzyme, wide peptide length and charge ranges.',
      'A very large or redundant database.',
      'Many large files at once, or other programs using the memory.',
    ],
    fixes: [
      'Reinstall the app from its releases page; unset PROSE_BIN if you did not mean to use another ProSE.',
      'Keep only the variable modifications your sample needs; make complete chemistry fixed; use an unspecific digest only where it is needed (immunopeptidomics) and then limit length and charges.',
      'For a large database, set “Database chunk size” under “Advanced settings”: it bounds the memory of the fragment index, not of the spectra, and it cannot be combined with “Co-isolated precursors”.',
      'Lower Threads when other work needs the computer; test one complete file before the whole experiment.',
      'Do not shrink the database or relax the FDR to make an infeasible search fit.',
    ],
    checks: ['tool'],
  },
  {
    id: 'faq-reproduce',
    group: 'app',
    question: 'How do I reproduce a search, or send what is needed for help?',
    symptoms: 'A search gives different results after an update or on another computer, a colleague cannot repeat it, or a problem needs reporting.',
    causes: [
      'A different ProSE or app version, or different defaults.',
      'Different settings, database, input files or design than remembered.',
      'A genuine change of behaviour between versions.',
    ],
    fixes: [
      'Start from the search itself: History › Settings opens its files, design, database and settings in New search, History › Re-run starts it again. A preset holds only settings (and a database), not the Percolator and PeptDeep switches.',
      'Keep with the results: the version and the methods text (Overview), the command line (“Copy command line” in Overview, “Command line” in History), the FASTA, and the input files.',
      'Compare two searches only at the same version, settings, database and FDR; if they differ when everything matches, report both records.',
      'Save a project (File › Save Project, or Save project… in New search): a .prose-setup.json with the files’ paths and sizes, the design, the database, every setting, the SDRF’s path and the state of the views. Open Project sets the same search up again and names any file that moved or changed since; it opens the search in Results if History has it.',
      'A results archive (.prose, Export › Results archive) holds the results and the search record for colleagues to view, but not the spectra, the full searched FASTA or the log (it keeps only the sequences of the proteins in the results): to repeat the search they need those too.',
      'When reporting a problem, give the app and ProSE versions, the command line, the log, and, if you can, a small input that shows it.',
    ],
    checks: [],
    outside: 'Report problems of the app or of ProSE on the prose-gui GitHub issues page (linked under Videos and links).',
  },
]

/** The first entry whose `checks` include `checkId`. */
export function faqFor(checkId: string): FaqEntry | undefined {
  return FAQ.find((e) => e.checks?.includes(checkId))
}
