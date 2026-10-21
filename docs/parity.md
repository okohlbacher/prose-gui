# Output parity: the web app's result types and ProSE's outputs

The desktop app shows ProSE's results in the web app's screens, so it has to fill the web app's result types
(`ResultTables`, `StoredSpectra`, `ProSEMultiSummary`, in `prose-pages/app/public/openms/openms.d.ts`; semantics in
`prose-pages/docs/prose-app-spec.md` §4.5–4.8) from the files the ProSE tool writes. This document lists every field,
where it comes from, and a verdict:

- **available**: a column or key of a ProSE output holds it as it is (or as a plain unit or index change);
- **derived in the UI**: the reader computes it from available values (the derivation is given);
- **added in #10676**: no output had it; OpenMS PR [#10676](https://github.com/OpenMS/OpenMS/pull/10676) (draft, to
  `develop`, in the pin `native/OPENMS_COMMIT`) adds it;
- **not needed**: the desktop app does not show it (the reason is given).

Checked against ProSE of the pin (`native/OPENMS_COMMIT`: develop + #10641 + #10676) on the web app's example and the
TOPP test data (`DatabaseSuitability_in_spec.mzML`, one and two inputs, closed and open search, with and without
Percolator and PeptDeep).

**The app reads only QPX** (the user's decision, 2026-10-21): the QPX psm and pg views ProSE writes with `-out_qpx`,
with the optional columns and the footer metadata of its `-qpx_extended` (#10676). QPX readers ignore columns and
keys they do not know (QPX `docs/spec/serialization.md`); the column names are those proposed in
[bigbio/qpx#355](https://github.com/bigbio/qpx/issues/355) (and `spectrum_reference` of
[#259](https://github.com/bigbio/qpx/issues/259)), so that they need no rename if QPX adopts them. OpenMS' own
Parquet (`-out_parquet`), the PSM spectra sidecar (gone from the tool) and the summary YAML (`-summary_out`) are not
written for the app any more.

## How the app runs ProSE

```
ProSE -in <files…> -database <fasta (+ cRAP)> -threads <n> -Search:… (form)
      -out_qpx <dir>/qpx -qpx_extended -qpx_peak_window 100 -qpx_peak_top 300
      -keep_decoys
      [-out_merged <dir>/merged.idXML]                  (two or more inputs: the pooled inference, and the Export menu's idXML)
      [-out_idxml <dir>/search.idXML]                   (one input: the Export menu's idXML)
      [-out_mod_analysis_dir <dir>/mods]                 (open search)
```

| Short name | File | Content |
| --- | --- | --- |
| psm | `qpx/<stem>.psm.parquet` (per input) | one row per written PSM (best hit of a spectrum): the QPX psm view, with the columns of `-qpx_extended` (below) |
| merged psm | `qpx/quantms.psm.parquet` | the rows of all inputs, the same footer; the reader does not read it, History reads its footer (`psmsOfSearch`) |
| pg | `qpx/quantms.pg.parquet` | the protein groups: of one input its own (`<stem>.pg.parquet`); of several the pooled inference of `-out_merged` (with its protein FDR, decoys kept by `-keep_decoys`); without protein inference one group per protein |
| footer | the Parquet footer key-value metadata of every psm file (the same in all of them) | the statistics of the run, `prose_` keys (below) |
| mod TSV | `mods/<the footer's prose_mod_analysis_delta_masses>`, `…_ptms` | open-search modification analysis (header lines `# Total PSMs: …` and a table) |
| FASTA | `proteins.fasta`, `database.fasta`, or the database the footer names | protein descriptions and sequences |

The columns `-qpx_extended` adds to the psm view: `additional_scores` with **every** numeric score and meta value of
the PSM in snake_case (`global_qvalue`: the PSM q-value of its input file; `ln_hyperscore`; `percolator_score`,
`percolator_qvalue`, `percolator_pep`; `precursor_mz_error_ppm`, `isotope_error`, `delta_mass`, the Percolator
features, PeptDeep's), with `higher_better` where it is known; `spectrum_reference` (the native ID); `isotope_error`
(int16, observed minus theoretical); `protein_mappings` (accession, 1-based `start`/`end`, `aa_before`/`aa_after`, `-`
at a protein terminus); `peak_mz_array`/`peak_intensity_array` (float32, by m/z, filtered: the 300 most intense peaks
per 100 m/z (WindowMower, jumping windows) and every peak of the fragment annotation `mz_array`);
`predicted_ion_type_array`/`predicted_mz_array`/`predicted_intensity_array` (PeptDeep, below).

The footer keys (the tool's documentation, `-qpx_extended`): `prose_database_file`, `prose_enzyme`,
`prose_enzyme_specificity`, `prose_clip_nterm_methionine`, `prose_decoy_mode`, `prose_decoy_string`,
`prose_decoy_position`, `prose_open_search`, `prose_calibration`, `prose_chunked`, `prose_db_target_proteins`,
`prose_db_decoy_proteins`, `prose_indexed_peptides`, `prose_indexed_fragments`, `prose_seconds_index_build`,
`prose_seconds_total`, `prose_min_charge`, `prose_max_charge`, `prose_psm_fdr`, `prose_protein_fdr`,
`prose_protein_fdr_applied`, `prose_extra_features`, `prose_peak_window`, `prose_peak_top`,
`prose_mod_analysis_delta_masses`, `prose_mod_analysis_ptms` and `prose_files` (JSON, one object per input in input
order: `input_file`, `exit_code`, `ms2_spectra`, `target_psms`, `decoy_psms`, `percolator` {`applied`,
`skipped_reason`, `warning`}, `peptdeep_nce`, `precursor_error`/`fragment_error` {`median_ppm`, `mad_ppm`,
`recommended_ppm`} or null, `seconds_search`).

All Parquet files are Zstandard-compressed (Arrow C++): the reader needs a Zstandard decoder (hyparquet has Snappy
only). The FASTA is the folder's `database.fasta` with contaminants; without them ProSE searched the user's file,
whose path is the footer's `prose_database_file` (absolute, outside the search folder): the shim serves that path
only if the folder's `database.json` (written by the shim at the start of such a search) records it.

**Precision.** QPX has `observed_mz`, `calculated_mz` and `rt` as float32 (OpenMS' own Parquet had doubles): the m/z
and RT the app shows agree with the web app's within float32's precision, a relative 1e-7 (0.1 ppm), and so do the
.pin features `CalcMass` and `mass`; `dm`/`absdm` (differences of two of them) within 2e-4 Da. The tests compare with
these tolerances (`src/lib/results/read.test.ts`). The scores are doubles as before.

**Protein sequences and descriptions** come, in this order, from `proteins.fasta` in the search folder (the identified
proteins of the table, decoys as searched; the app writes it when it saves the search to History), from the database (`database.fasta`, else the footer's `prose_database_file`), or
not at all: then the sequences are '' (no coverage), the descriptions those of the pg view (`pg_names`), and the reader returns a warning
(`SearchResult.warnings`); it does not fail.

**History** adds two files to the folder when a search is saved (after `search://done`): `proteins.fasta` and, last,
`search.json` (schema 1: `schema, id, name, createdAt, appVersion, toolVersion, files, database, design, settings,
psms, psmFdr, proteinFdr, seconds`, see `src/lib/history/history.ts`; `psms` from the footer of
`qpx/quantms.psm.parquet`, read from the file's last bytes only). A folder with `search.json` is a saved search; a
project file (`.prose`) is a zip of the folder's regular files (not the links to the inputs, not `database.fasta`, not
`database.json`; `inputs.json` with the file names only). An imported search has `imported: true` in `search.json`:
it reads only the files of its folder (no absolute path is served). A running search or import holds an exclusive
lock on `<id>.partial/.lock`, which the startup sweep honours.

**Searches of the earlier layout** (saved by the app before task 11: `summary.yaml`, `oms/`, `spectra/` next to QPX
files without the `-qpx_extended` columns): the reader refuses them with a clear message (`OldLayoutError`: "This
search was saved by an earlier version of ProSE Desktop, whose results this version cannot read. Open it with that
version, or run the search again."), shown where History or Open project opens them; nothing crashes.

**Missing files**: the reader's `files` callback rejects with `FileNotFound` (anything with `notFound: true`) for a file
that does not exist; only that counts as missing (a failed input's psm file, the pg file, mod TSVs, a FASTA source).
Any other error fails the read, naming the file; so does a file that cannot be parsed, and a psm file without the
columns and footer of `-qpx_extended`.

Rows: the PSM rows of `ResultTables.psms` are the QPX psm rows of the files in input order; their peaks and
predictions are columns of the same rows (`src/lib/results/read.ts`).

## ResultTables

| Field | Source | Verdict |
| --- | --- | --- |
| `files` | the input paths the app passed (the footer's `prose_files[].input_file` is the basename, in the same order) | available |
| `psms.count` | number of rows of the psm files | available |
| `psms.file` | position of the row's file in `files` (the psm file it comes from) | derived in the UI |
| `psms.nativeId` | psm `spectrum_reference` (-qpx_extended; QPX `scan` has the scan number only) | **added in #10676** |
| `psms.rt` | psm `rt` (float32); null → NaN | available (float32) |
| `psms.mz` | psm `observed_mz` (float32) | available (float32) |
| `psms.charge` | psm `charge` | available |
| `psms.peptide` | index into `peptides`, unique by peptidoform | derived in the UI (dedupe in row order) |
| `psms.score` | Percolator's SVM score: `additional_scores` `percolator_score`; without rescoring ProSE's ln(hyperscore): `ln_hyperscore`. A hit Percolator could not rescore: −100 (as in the output) | available (by name; **all scores added in #10676**: the QPX writer itself puts only the known scores there, under OpenMS names) |
| `psms.qValue` | `additional_scores` `global_qvalue` (the PSM's main score: Percolator's q-value, or the target-decoy q-value of FDR:PSM > 0, per input file), else `percolator_qvalue`. No decoys → NaN | available; with FDR:PSM 0 and no rescoring there is none: **the app always sends FDR:PSM > 0** (the form's FDR) |
| `psms.pep` | psm `posterior_error_probability` (= `percolator_pep`); null → NaN | available |
| `psms.precursorErrorPpm` | `additional_scores` `precursor_mz_error_ppm` (ProSE's, isotope-corrected, as the web app; QPX `mass_error_ppm` is not); without it computed from `observed_mz`, `calculated_mz` and `isotope_error`: (observed − isotope × 1.0033548378 / charge − calculated) / calculated × 10⁶ | available |
| `psms.isotopeError` | psm `isotope_error` (int16, observed minus theoretical: ProSE converts from its `report:isotope_error_convention`); null → 0 | **added in #10676** |
| `psms.deltaMass` | `additional_scores` `delta_mass` (open search only); closed search → NaN | available |
| `psms.decoy` | psm `is_decoy` | available |
| `psms.featureNames`, `psms.features` | `ln(hyperscore)` (`ln_hyperscore`); the run's extra features (footer `prose_extra_features`, by their `additional_scores` names) with their values from `additional_scores`; PeptDeep's five from `additional_scores` when `peptdeep:enable`; the standard .pin features (below) | available, except the standard .pin features: derived in the UI |
| ↳ standard .pin features | as `PercolatorInfile::stampPinFeaturesOnHits`: `CalcMass` = `calculated_mz`; `mass` = `observed_mz`; `peplen` = length of `sequence`; `charge<N>` = (charge = N) for N in the footer's `prose_min_charge`..`prose_max_charge` (widened to the PSMs'); `dm` = `observed_mz` − `isotope_error` (the `additional_scores` one, ProSE's meta value as Percolator saw it) × 1.0033548378 / charge − `calculated_mz`; `absdm` = |`dm`|; `enzN`/`enzC`/`enzInt` = Percolator's cleavage rule of the footer's `prose_enzyme` (`PercolatorInfile::isEnz_`, a dozen enzymes) on `aa_before`/first residue, last residue/`aa_after` (`protein_mappings[0]`; QPX's `-` at a terminus taken as OpenMS' `[`/`]`, which Percolator's features were computed with) and the residues inside | derived in the UI (port of the rule table; float32 m/z: see "Precision") |
| `peptides.count` | distinct peptidoforms | derived in the UI |
| `peptides.openms` | AASequence spelling: `sequence` + `modifications` (`X(Name)`, `.(Name)X…` N-terminal, `…X.(Name)` C-terminal) | derived in the UI (used as a key and for display; the UI computes no masses from it) |
| `peptides.proforma` | ProForma with Unimod names, fixed modifications included: `sequence` + `modifications` (name, positions), as the web app's rule (`[Name]-` N-term, `X[Name]`, `-[Name]` C-term, mass-only names as `[+m]`); never the open-search shift | derived in the UI (QPX `peptidoform` is canonical ProForma with accessions) |
| `peptides.sequence` | psm `sequence` | available |
| `peptides.decoy` | psm `is_decoy` of its PSMs | available |
| `peptides.modOffsets` | CSR offsets over the modifications | derived in the UI |
| `peptides.modPosition` | `modifications[].positions[].position`: 0 → −1 (N-term), *n*+1 → length (C-term), else position − 1 | available (index change) |
| `peptides.modName` | `modifications[].name` (Unimod name; mass-only modifications as their mass) | available |
| `peptides.modUnimod` | `modifications[].accession` `UNIMOD:35` → 35; null → −1 | available |
| `peptides.modMass` | the modification's monoisotopic mass delta: from the app's modification table (Unimod accession → mass, else name → mass), or the mass of a mass-only name. The table is **generated from the pin's Unimod file (`share/OpenMS/CHEMISTRY/unimod.xml` of `native/OPENMS_COMMIT`, which ModificationsDB reads) by `scripts/unimod-table.mjs` into `src/lib/chemistry/unimod.json` (committed; regenerate with the pin)** | derived in the UI (no output carries it; the TypeScript fragment annotation needs the same table) |
| `peptides.proteinOffsets`, `peptides.protein` | `protein_mappings[].accession` of the peptide's first PSM, kept where the protein is in the proteins table (see `proteins`); none left → "below protein FDR" | derived in the UI |
| `peptides.start`, `peptides.end` | `protein_mappings[].start` / `end` (1-based, `end` inclusive → `start` − 1, `end`); the web app's check against the sequence (FASTA) | **added in #10676** |
| `proteins.count`, `proteins.accession` | the members (`pg_accessions`) of the groups of the pg view, in their order; of several inputs the pooled inference | available (pooled pg: **added in #10676**) |
| `proteins.description` | pg `pg_names` if set, else the FASTA header; a generated decoy has the description of its target (as the web app: it looks the decoy up by its target's accession) | derived in the UI (the FASTA is read anyway) |
| `proteins.sequence` | FASTA; a decoy ProSE generated: the reversal ProSE uses (`DecoyGenerator::reversePeptides` for the footer's `prose_enzyme`, `reverseProtein` for `prose_enzyme_specificity` none, initial M kept with `prose_clip_nterm_methionine`), as the web app's engine regenerated it | derived in the UI |
| `proteins.score` | best `psms.score` of the protein's PSMs | derived in the UI (as the web app) |
| `proteins.qValue` | when the protein FDR was applied (footer `prose_protein_fdr_applied`): the group's `additional_scores` entry (the score of its first protein, the protein q-value of the picked-protein FDR; the members of an indistinguishable group share it), else the group's `global_qvalue` (the q-value of the group FDR); otherwise NaN | available |
| `proteins.decoy` | the decoy marker (footer `prose_decoy_string`, `prose_decoy_position`), or pg `is_decoy` of a group of one protein | available |
| `proteins.group` | index of the protein's group: groups distinct by `pg_accessions` (the pooled pg has a row per group and input). **Without protein inference (one input, no protein FDR) `-qpx_extended` writes one group per protein**, as the web app (its pooled run of one file) | available; pooled and singleton groups **added in #10676** |

## StoredSpectra

| Field | Source | Verdict |
| --- | --- | --- |
| `psmSpectrum` | one spectrum per PSM row: the row's own peaks (index = row; PSMs of one spectrum are separate rows with the same peaks) | **added in #10676** |
| `offsets`, `mz`, `intensity` | psm `peak_mz_array`, `peak_intensity_array` (float32, by m/z, as the input file has them, **filtered**: the 300 most intense peaks per 100 m/z and every annotated peak; null when the spectrum was not found or the file could not be read again). The PSM view says so ("Top 300 peaks per 100 m/z shown, and every peak ProSE annotated", from the footer's `prose_peak_top` and `prose_peak_window`; `SearchResult.peakFilter`). On the example (at most 77 peaks per spectrum) nothing is filtered | **added in #10676** |
| `precursorMz` | psm `observed_mz` of the row (float32) | available |
| `collisionEnergy` | — (the reader fills NaN) | not needed: the web app used it only as a fallback NCE for predicting in the browser; the desktop app shows ProSE's prediction, made at the file's `peptdeep_nce` |

The peak filter, measured (task 11 report) on an Orbitrap HCD run (iPRG2015 `JD_06232014_sample1_A`, Q Exactive,
~1,130 peaks per MS2 spectrum, 20,716 PSMs) against the TypeScript annotation of the PSM view (b/y/a/c/x/z,
charge 1–2, 20 ppm) on the unfiltered peaks: the share of its matched peaks that the filter removes is 25.7 % at 10
per 100 m/z, 18.1 % at 20, 10.5 % at 50, 6.7 % at 100, 4.6 % at 150, 3.2 % at 200, 2.2 % at 250 and **1.5 % at 300 (the
default)**; of b/y matches alone 9.3, 7.2, 3.5, 2.0, 1.4, 1.0, 0.7 and 0.5 %; of the matched intensity 2.4 % at 10 and
0.0 % from 100 on. The psm file of that run: 98.8 MB unfiltered, 22.6 MB at 10, 66.2 MB at 100, 90.8 MB at 300.

The PeptDeep prediction for the PSM view (the web app's `predictMS2()` result) is in the psm's
`predicted_ion_type_array` (`b3+`, `y5++`, named as the QPX `ion_type_array`; the web app writes `b3`, `y5++`),
`predicted_mz_array`, `predicted_intensity_array`: b/y of charge 1 and (precursor charge ≥ 2) 2, relative to the most
intense, > 0.01, by m/z, precursor charges 1–6 — the same rule as the web app's `predictMS2()`. **Added in #10676**, for
every written PSM, also without PeptDeep rescoring (with it, recomputed at the NCE the rescoring used); null where the
prediction failed or without ONNX Runtime. The fragment annotation of ProSE's own scoring stays in QPX `mz_array`,
`intensity_array`, `charge_array`, `ion_type_array`. The reader gives them as `PredictedSpectra` (`src/lib/results/types.ts`:
one range per PSM row, the ions named as the web app names them, `b3+` → `b3`); on the web app's example they equal its
`predictMS2()` of each PSM's peptide at the file's NCE within 1e-5 (intensity) and float32 (m/z), ion for ion.

## ProSEMultiSummary

| Field | Source | Verdict |
| --- | --- | --- |
| `files[].path` | the app's input path (`prose_files[].input_file` is its basename) | available |
| `files[].status` | `prose_files[].exit_code` (0 `EXECUTION_OK`, 1 `INPUT_FILE_EMPTY`, 2 `UNEXPECTED_RESULT`, 3 `UNKNOWN_ERROR`, 4 `ILLEGAL_PARAMETERS`) | **added in #10676** (footer) |
| `files[].ms2Spectra` | `prose_files[].ms2_spectra` | **added in #10676** (footer) |
| `files[].targetPSMs`, `decoyPSMs` | `prose_files[].target_psms`, `decoy_psms` (after the FDR filters; with `-keep_decoys` the decoys that pass) | **added in #10676** (footer) |
| `files[].percolator` | `prose_files[].percolator.applied`, `skipped_reason`, `warning` ('' → null); `null` when the search ran with `Search:rescore false` (`applied: false` with an empty `skipped_reason`) | **added in #10676** (footer) |
| `files[].peptdeepNce` | `prose_files[].peptdeep_nce` (the NCE of the file's predictions) | **added in #10676** (footer) |
| `files[].precursorError`, `fragmentError` | `prose_files[].precursor_error` / `fragment_error` (`median_ppm`, `mad_ppm`, `recommended_ppm`; null: no estimate), doubles | **added in #10676** (footer) |
| `files[].secondsSearch` | `prose_files[].seconds_search` | **added in #10676** (footer) |
| `search.databaseFile`, `enzyme`, `openSearch`, `chunked`, `decoyMode`, `indexedPeptides`, `indexedFragments`, `secondsIndexBuild`, `secondsTotal` | footer `prose_database_file`, `prose_enzyme`, `prose_open_search`, `prose_chunked`, `prose_decoy_mode`, `prose_indexed_peptides`, `prose_indexed_fragments`, `prose_seconds_index_build`, `prose_seconds_total` (the time until the QPX files are written, the end of the run) | **added in #10676** (footer) |
| `search.calibration` | footer `prose_calibration` | **added in #10676** (footer) |
| `search.targetProteins`, `decoyProteins` | footer `prose_db_target_proteins`, `prose_db_decoy_proteins` | **added in #10676** (footer) |
| `proteinFdrApplied` | footer `prose_protein_fdr_applied` | **added in #10676** (footer) |
| `psmFdr`, `proteinFdr` | footer `prose_psm_fdr`, `prose_protein_fdr` | **added in #10676** (footer) |
| `decoyString` | footer `prose_decoy_string` (`DECOY_`; position `prose_decoy_position`); the web app's screens do not use it (decoys are flagged per row: `is_decoy`), but the type has it | **added in #10676** (footer) |
| `openSearch` | footer `prose_open_search` | **added in #10676** (footer) |
| `modificationAnalysis` | null in closed search; the TSVs the footer names (`prose_mod_analysis_delta_masses`, `prose_mod_analysis_ptms`: of one input its own, of several the `_aggregate_across_files` ones) | available |
| ↳ `deltaMasses.totalPSMs`, `modifiedPSMs`, `unmodifiedPSMs`, `meanDeltaMass`, `medianDeltaMass` | DeltaMassStats header lines `# Total PSMs:`, `# Modified PSMs:`, `# Unmodified PSMs:`, `# Mean Delta Mass:`, `# Median Delta Mass:` | available |
| ↳ `deltaMasses.entries[]` | DeltaMassStats rows: `DeltaMass`, `Count`, `UniquePeptides`, `ChargeStates`, `Percentage`, `MappedModification`, `IsKnown` | available |
| ↳ `ptms.totalModifiedPSMs`, `unknownModificationPSMs`, `uniqueModifications` | PTMStats header lines | available |
| ↳ `ptms.entries[]` `name`, `theoreticalMass`, `observedMass`, `massDeviation`, `count`, `uniquePeptides`, `percentage`, `targetResidues` | PTMStats columns (the TSVs have six significant digits, the web app the doubles) | available |
| ↳ `ptms.entries[].chargeStates` | — (PTMStats has no charge column; the reader fills 0) | not needed: the web app's screens do not show it |
| ↳ `ptms.entries[].residueCounts` | PTMStats `ResidueFrequency` (`A:4,D:2,…`; equals the web app's) | available (the web app does not show it: `delta-mass.ts` counts every residue of the peptides) |

The modification analysis stays in the tool's TSVs (`-out_mod_analysis_dir`): it has no QPX counterpart.

## Values whose source changed with the QPX-only reader (task 11)

Before, the reader took them from OpenMS' own Parquet (OMS), the sidecar or `summary.yaml`:

| Value | Before | Now |
| --- | --- | --- |
| native ID | OMS `spectrum_reference` | psm `spectrum_reference` |
| RT, precursor m/z, `CalcMass`, `mass`, `dm`, `absdm` | OMS doubles | psm float32 (agree within 1e-7 relative, `dm` within 2e-4 Da) |
| scores, q-value, Percolator outputs, features | OMS `score`/`score_type`, `psm_metavalues` (text) | psm `additional_scores` (doubles, snake_case) |
| precursor error (ppm), delta mass | OMS `psm_metavalues` | `additional_scores` `precursor_mz_error_ppm`, `delta_mass` |
| isotope error | OMS `psm_metavalues` with the run's convention | psm `isotope_error` (observed minus theoretical) |
| proteins of a peptide, positions, flanking residues | OMS `protein_accessions` (0-based, `[`/`]` termini) | psm `protein_mappings` (1-based, `-` termini) |
| enzyme, specificity, initial-M rule, decoy marker, extra features | OMS search params | footer |
| proteins, descriptions, decoys, q-values, groups | OMS proteins/pg (and merged) | QPX pg (`quantms.pg.parquet`); without inference, singleton groups written by the tool instead of derived in the reader |
| peaks, predictions | sidecar (all peaks) | psm columns (peaks filtered) |
| per-file and search statistics, protein FDR applied, mods pointers | `summary.yaml` | footer |
| History's PSM count | `summary.yaml` | footer of `qpx/quantms.psm.parquet` (its last bytes) |
| the user's database path the shim serves | `summary.yaml` | the shim's `database.json` |

Nothing the app displays had to stay outside QPX but the modification analysis (TSVs, as before) and the protein
sequences (FASTA, as before).

## The explicit checks

- **Pooled q-values across files, decoys kept.** The web app's PSM table pools the PSMs of all files and keeps each
  file's own q-values (Percolator per file, or target-decoy competition per file); the psm files are exactly that,
  concatenated. Decoys: one input with FDR:protein > 0 would remove them — closed by `-keep_decoys` (#10676), which
  keeps the decoy PSMs and proteins that pass, as the web app's `removeDecoys: false`.
- **Percolator features of the PSM view.** ln(hyperscore), the extra features and PeptDeep's are in `additional_scores`
  (the extra features named in the footer's `prose_extra_features`); the standard .pin features are derived in the UI
  with PercolatorInfile's formulas (table above). `percolator_score`, `percolator_qvalue`, `percolator_pep` are there too.
- **Per-file statistics.** MS2 spectra, target and decoy PSMs, seconds, Percolator applied or skipped (with the
  reason and the warning), the NCE: the footer's `prose_files`.
- **Protein sequences for coverage.** No ProSE output has them; the UI reads the FASTA, and regenerates ProSE's
  generated decoys with its rule. Positions of the peptides in the proteins are in `protein_mappings`.
- **Protein groups.** The QPX pg view: of one input its own; of several the pooled inference of `-out_merged`
  (`quantms.pg.parquet`, #10676); without inference one group per protein (#10676).
- **Modification arrays and ProForma.** QPX `modifications` (name, `UNIMOD:` accession, positions with N-/C-terminal
  0/*n*+1) give names, accessions and positions; the ProForma and AASequence spellings are composed in the UI; masses
  come from the app's modification table, generated at build time from the pin's ModificationsDB/unimod.xml (no
  output has them).
- **NCE per file.** The footer's `prose_files[].peptdeep_nce` — for every file with predictions, also without PeptDeep
  rescoring (then selected by PeptDeep rescoring run on a copy of the written PSMs; `peptdeep:nce` if set).
- **Delta masses of open search.** `additional_scores` `delta_mass` per PSM; the aggregate tables in the mod TSVs.

## What the app must pass

`-out_qpx` with `-qpx_extended` (and the peak filter's `-qpx_peak_window`, `-qpx_peak_top`) and `-keep_decoys` always;
`-out_merged` for two or more inputs (the pooled proteins); FDR:PSM > 0 (q-values without Percolator);
`-out_mod_analysis_dir` in open search. Inputs must have distinct file names (stems, `a.mzML` and `a.mzML.gz`
included): ProSE refuses two inputs of the same name in different folders (exit code 6), as their per-input outputs
would overwrite each other; the app has to say so before it starts. `.mzML.gz` inputs work (their peaks equal those
of the uncompressed file). The per-input psm files are written at the end of the run (their footer needs the
statistics of the whole run). A failed re-read or prediction leaves null columns and a warning in the log, never a
failed search; with ONNX Runtime missing in a build, the `predicted_*` columns are null and the PSM view shows the
theoretical spectrum only.
