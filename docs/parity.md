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

Checked against ProSE of the pin (develop 8d0afe11a5 + #10641 + #10676) on the TOPP test data
(`DatabaseSuitability_in_spec.mzML`, one and two inputs, closed and open search, with and without Percolator and
PeptDeep).

## How the app runs ProSE

```
ProSE -in <files…> -database <fasta (+ cRAP)> -threads <n> -Search:… (form)
      -out_qpx <dir>/qpx -qpx_spectra -out_parquet <dir>/oms -summary_out <dir>/summary.yaml -keep_decoys
      [-out_merged <dir>/merged.idXML]                  (two or more inputs)
      [-out_mod_analysis_dir <dir>/mods]                 (open search)
```

| Short name | File | Content |
| --- | --- | --- |
| QPX psm | `qpx/<stem>.psm.parquet` (per input; `qpx/quantms.psm.parquet` concatenates them) | one row per written PSM (best hit of a spectrum), QPX psm view + the five spectrum columns of `-qpx_spectra` |
| OMS psm | `oms/<stem>.psm.parquet` (`oms/openms.psm.parquet` concatenates them) | the same rows in OpenMS' internal schema: `spectrum_reference`, `score`/`score_type`, `additional_scores`, `psm_metavalues`, `protein_accessions` (with `start`/`end`) |
| OMS proteins, pg | `oms/<stem>.proteins.parquet`, `oms/<stem>.pg.parquet` | protein hits and groups of the file's run (inferred only with protein FDR on one input) |
| merged proteins, pg | `oms/merged.proteins.parquet`, `oms/merged.pg.parquet` | proteins and groups of the pooled inference and protein FDR of `-out_merged` (new in #10676) |
| OMS search params | `oms/<stem>.search_params.parquet` | run settings, run meta values (`peptdeep_nce`), `extra_features` |
| YAML | `summary.yaml` | end-of-search report: `shared`, `per_file[]`, `outputs`, `protein_fdr_applied` |
| mod TSV | `mods/<stem>_ModificationAnalysis_{DeltaMassStats,PTMStats}.tsv`, `mods/_aggregate_across_files_…` | open-search modification analysis (header lines `# Total PSMs: …` and a table) |
| FASTA | the database the app passed | protein descriptions and sequences |

Rows: the PSM rows of `ResultTables.psms` are the QPX psm rows of the files in input order (QPX psm and OMS psm
have the same rows in the same order, one per peptide identification with hits). The QPX `scan` is the native ID's scan
number only, so rows are joined to OMS psm by position (or by `run_file_name` + `scan` + `peptidoform` + `charge`).

## ResultTables

| Field | Source | Verdict |
| --- | --- | --- |
| `files` | the input paths the app passed (YAML `per_file[].input_file` is the basename, in the same order) | available |
| `psms.count` | number of rows of the QPX psm files | available |
| `psms.file` | position of the row's file: QPX `run_file_name` (stem) / OMS `reference_file_name` matched to `files` | derived in the UI (stem → index) |
| `psms.nativeId` | OMS psm `spectrum_reference` | available |
| `psms.rt` | QPX `rt` (float32) or OMS `rt` (double); null → NaN | available |
| `psms.mz` | OMS `observed_mz` (double; QPX has float32) | available |
| `psms.charge` | QPX `charge` | available |
| `psms.peptide` | index into `peptides`, unique by peptidoform | derived in the UI (dedupe QPX `peptidoform` in row order) |
| `psms.score` | Percolator's SVM score: OMS `psm_metavalues` `percolator_score` (QPX `additional_scores` `MS:1001492`); without rescoring ProSE's ln(hyperscore): the `additional_scores` entry `ln(hyperscore)` (named `ln(hyperscore)_score` once the FDR made the q-value the main score), or OMS `score` while `score_type` is `ln(hyperscore)`. A hit Percolator could not rescore: −100 (as in the output) | available (pick by name) |
| `psms.qValue` | rescored: `percolator_q_value` (= OMS `score` with `score_type` `q-value`); not rescored: OMS `score` when `score_type` is `q-value` (FDR:PSM > 0 computes the target-decoy q-values per file). No decoys → NaN | available; with FDR:PSM 0 and no rescoring there is none: **the app always sends FDR:PSM > 0** (the form's FDR) |
| `psms.pep` | QPX `posterior_error_probability` (= `percolator_pep`); null → NaN | available |
| `psms.precursorErrorPpm` | OMS `psm_metavalues` `precursor_mz_error_ppm` (isotope-corrected, as the web app; QPX `mass_error_ppm` is not) | available |
| `psms.isotopeError` | OMS `psm_metavalues` `isotope_error` with the run's `isotope_error_convention` (`observed_minus_theoretical`: as is); absent → 0 | available |
| `psms.deltaMass` | OMS `psm_metavalues` `DeltaMass` (open search only); closed search → NaN | available |
| `psms.decoy` | QPX `is_decoy` | available |
| `psms.featureNames`, `psms.features` | `ln(hyperscore)` (as `psms.score` without rescoring); the run's `extra_features` (OMS search params `sp_metavalues`) with their values from OMS `psm_metavalues`; PeptDeep's five from `psm_metavalues` when `peptdeep:enable`; the standard .pin features (below) | available, except the standard .pin features: derived in the UI |
| ↳ standard .pin features | as `PercolatorInfile::stampPinFeaturesOnHits`: `CalcMass` = OMS `calculated_mz`; `mass` = OMS `observed_mz`; `peplen` = length of QPX `sequence`; `charge<N>` = (charge = N) for N in the search's charges (OMS search params `charges`, e.g. `2:5`, widened to the PSMs'); `dm` = `observed_mz` − `isotope_error` × 1.0033548378 / charge − `calculated_mz`; `absdm` = |`dm`|; `enzN`/`enzC`/`enzInt` = Percolator's cleavage rule of the search's enzyme (`PercolatorInfile::isEnz_`, a dozen enzymes) on `aa_before`/first residue, last residue/`aa_after` (OMS `protein_accessions[0]`) and the residues inside | derived in the UI (port of the rule table; the web app's engine computed them the same way, on copies) |
| `peptides.count` | distinct peptidoforms | derived in the UI |
| `peptides.openms` | AASequence spelling: QPX `sequence` + `modifications` (`X(Name)`, `.(Name)X…` N-terminal, `…X.(Name)` C-terminal) | derived in the UI (used as a key and for display; the UI computes no masses from it) |
| `peptides.proforma` | ProForma with Unimod names, fixed modifications included: QPX `sequence` + `modifications` (name, positions), as the web app's rule (`[Name]-` N-term, `X[Name]`, `-[Name]` C-term, mass-only names as `[+m]`); never the open-search shift | derived in the UI (QPX `peptidoform` is canonical ProForma with accessions) |
| `peptides.sequence` | QPX `sequence` | available |
| `peptides.decoy` | QPX `is_decoy` of its PSMs | available |
| `peptides.modOffsets` | CSR offsets over the modifications | derived in the UI |
| `peptides.modPosition` | QPX `modifications[].positions[].position`: 0 → −1 (N-term), *n*+1 → length (C-term), else position − 1 | available (index change) |
| `peptides.modName` | QPX `modifications[].name` (Unimod name; mass-only modifications as their mass) | available |
| `peptides.modUnimod` | QPX `modifications[].accession` `UNIMOD:35` → 35; null → −1 | available |
| `peptides.modMass` | the modification's monoisotopic mass delta: from the app's bundled modification table (Unimod accession → mass; the same table the settings form lists the modifications from), or the mass of a mass-only name | derived in the UI (no output carries it; the TypeScript fragment annotation needs the same table) |
| `peptides.proteinOffsets`, `peptides.protein` | OMS psm `protein_accessions[].accession` of the peptide's first PSM, kept where the protein is in the proteins table (see `proteins`); none left → "below protein FDR" | derived in the UI |
| `peptides.start`, `peptides.end` | OMS `protein_accessions[].start` / `end` (0-based, `end` inclusive → `end` + 1); the web app's check against the sequence (FASTA) | available (+1) |
| `proteins.count`, `proteins.accession` | one input: OMS `<stem>.proteins.parquet`; several inputs: `merged.proteins.parquet` (pooled inference); without protein inference (no protein FDR, one input) the per-file protein hits | available; for several inputs **added in #10676** |
| `proteins.description` | FASTA header (generated decoys: none, as in the web app) | derived in the UI (the FASTA is read anyway) |
| `proteins.sequence` | FASTA; a decoy ProSE generated: the reversal ProSE uses (`DecoyGenerator::reversePeptides` for the search's enzyme, `reverseProtein` for `enzyme_specificity none`, initial M kept with `peptide:clip_nterm_methionine`), as the web app's engine regenerated it | derived in the UI (port of the decoy rule; until then '' for generated decoys, which the web app's type allows) |
| `proteins.score` | best `psms.score` of the protein's PSMs | derived in the UI (as the web app) |
| `proteins.qValue` | OMS proteins `score` when the protein FDR was applied (YAML `protein_fdr_applied`; protein score type `q-value`); else NaN | available; for several inputs **added in #10676** |
| `proteins.decoy` | OMS proteins `is_decoy` | available |
| `proteins.group` | index of the `indistinguishable` group in OMS `<stem>.pg.parquet` / `merged.pg.parquet` (`accessions`, `group_index`); −1 if none | available; for several inputs **added in #10676** |

## StoredSpectra

| Field | Source | Verdict |
| --- | --- | --- |
| `psmSpectrum` | one spectrum per PSM row: the row's own peaks (index = row; PSMs of one spectrum are separate rows with the same peaks) | **added in #10676** (`-qpx_spectra`) |
| `offsets`, `mz`, `intensity` | QPX `peak_mz_array`, `peak_intensity_array` (float32, every peak of the MS2 spectrum as read from the file, by m/z; null when the spectrum was not found) | **added in #10676** |
| `precursorMz` | OMS `observed_mz` of the row | available |
| `collisionEnergy` | — | not needed: the web app used it only as a fallback NCE for predicting in the browser; the desktop app shows ProSE's prediction (QPX `predicted_*`), made at the file's `peptdeep_nce` |

The PeptDeep prediction for the PSM view (the web app's `predictMS2()` result) is in QPX `predicted_ion_type_array`
(`b3+`, `y5++`, named as `ion_type_array`; the web app writes `b3`, `y5++`), `predicted_mz_array`,
`predicted_intensity_array`: b/y of charge 1 and (precursor charge ≥ 2) 2, relative to the most intense, > 0.01, by
m/z, precursor charges 1–6 — the same rule as the web app's `predictMS2()`. **Added in #10676**, for every written PSM,
also without PeptDeep rescoring. The fragment annotation of ProSE's own scoring stays in `mz_array`, `intensity_array`,
`charge_array`, `ion_type_array`.

## ProSEMultiSummary

| Field | Source | Verdict |
| --- | --- | --- |
| `files[].path` | the app's input path (YAML `per_file[].input_file` is its basename) | available |
| `files[].status` | YAML `per_file[].exit_code` (0 `EXECUTION_OK`, 1 `INPUT_FILE_EMPTY`, 2 `UNEXPECTED_RESULT`, 3 `UNKNOWN_ERROR`, 4 `ILLEGAL_PARAMETERS`) | available (enum map) |
| `files[].ms2Spectra` | YAML `per_file[].ms2_spectra` | available |
| `files[].targetPSMs`, `decoyPSMs` | YAML `per_file[].target_psms`, `decoy_psms` (after the FDR filters; with `-keep_decoys` the decoys that pass) | available |
| `files[].percolator` | YAML `per_file[].percolator.applied`, `skipped_reason`, `warning` ('' → null); `null` when the search ran with `Search:rescore false` | **added in #10676** |
| `files[].peptdeepNce` | YAML `per_file[].peptdeep_nce` (the NCE of the file's predictions; also the run meta value `peptdeep_nce` in OMS search params) | **added in #10676** (before: only with `peptdeep:enable`, and only in the search params) |
| `files[].precursorError`, `fragmentError` | YAML `per_file[].precursor_error` / `fragment_error` (`median_ppm`, `mad_ppm`, `recommended_ppm`; `valid: false` → null) | available |
| `files[].secondsSearch` | YAML `per_file[].timing_seconds.search` | available |
| `search.databaseFile`, `enzyme`, `openSearch`, `chunked`, `decoyMode`, `indexedPeptides`, `indexedFragments`, `secondsIndexBuild`, `secondsTotal` | YAML `shared.database_file`, `enzyme`, `open_search`, `chunked`, `decoy_mode`, `indexed_peptides`, `indexed_fragments`, `seconds_index_build`, `seconds_total` | available |
| `search.calibration` | YAML `shared.calibration_enabled` | available |
| `search.targetProteins`, `decoyProteins` | YAML `shared.db_target_proteins`, `db_decoy_proteins` | available |
| `proteinFdrApplied` | YAML `protein_fdr_applied` | **added in #10676** |
| `psmFdr`, `proteinFdr` | YAML `shared.psm_fdr_threshold`, `protein_fdr_threshold` | available |
| `decoyString` | YAML `shared.decoy_string` (`decoy_is_prefix` too) | **added in #10676** |
| `openSearch` | YAML `shared.open_search` | available |
| `modificationAnalysis` | null in closed search; one input: the file's mod TSVs; several: the `_aggregate_across_files` TSVs | available |
| ↳ `deltaMasses.totalPSMs`, `modifiedPSMs`, `unmodifiedPSMs`, `meanDeltaMass`, `medianDeltaMass` | DeltaMassStats header lines `# Total PSMs:`, `# Modified PSMs:`, `# Unmodified PSMs:`, `# Mean Delta Mass:`, `# Median Delta Mass:` | available |
| ↳ `deltaMasses.entries[]` | DeltaMassStats rows: `DeltaMass`, `Count`, `UniquePeptides`, `ChargeStates`, `Percentage`, `MappedModification`, `IsKnown` | available |
| ↳ `ptms.totalModifiedPSMs`, `unknownModificationPSMs`, `uniqueModifications` | PTMStats header lines | available |
| ↳ `ptms.entries[]` `name`, `theoreticalMass`, `observedMass`, `massDeviation`, `count`, `uniquePeptides`, `percentage`, `targetResidues` | PTMStats columns | available |
| ↳ `ptms.entries[].chargeStates` | — (PTMStats has no charge column) | not needed: the web app's screens do not show it |
| ↳ `ptms.entries[].residueCounts` | PTMStats `ResidueFrequency` | not needed: the web app does not show it (`delta-mass.ts`: it counts every residue of the peptides) |

## The explicit checks

- **Pooled q-values across files, decoys kept.** The web app's PSM table pools the PSMs of all files and keeps each
  file's own q-values (Percolator per file, or target-decoy competition per file); the QPX/OMS psm files are exactly
  that, concatenated. Decoys: several inputs keep them in the per-file outputs (no per-file protein FDR); one input
  with FDR:protein > 0 removed them — closed by `-keep_decoys` (#10676), which keeps the decoy PSMs and proteins that
  pass, as the web app's `removeDecoys: false`.
- **Percolator features of the PSM view.** ln(hyperscore), `extra_features` and PeptDeep's are in OMS `psm_metavalues`
  (the last two names listed in the run's `extra_features`); the standard .pin features are derived in the UI with
  PercolatorInfile's formulas (table above). `percolator_score`, `percolator_q_value`, `percolator_pep` are there too.
- **Per-file statistics.** MS2 spectra, target and decoy PSMs, seconds: YAML. Percolator applied or skipped (with the
  reason and the warning): added to the YAML in #10676.
- **Protein sequences for coverage.** No ProSE output has them (ProSE's own protein mapping writes none); the UI
  reads the FASTA, and regenerates ProSE's generated decoys with its rule. Positions of the peptides in the proteins
  are in OMS `protein_accessions` (`start`, `end` inclusive).
- **Protein groups.** One input: OMS/QPX `pg.parquet`. Several inputs: the pooled inference was only in the merged
  idXML — `merged.proteins.parquet` and `merged.pg.parquet` added in #10676.
- **Modification arrays and ProForma.** QPX `modifications` (name, `UNIMOD:` accession, positions with N-/C-terminal
  0/*n*+1) give names, accessions and positions; the ProForma and AASequence spellings are composed in the UI; masses
  come from the app's modification table (no output has them).
- **NCE per file.** YAML `per_file[].peptdeep_nce` and the run meta value `peptdeep_nce` — added in #10676 for every
  file with predictions, also without PeptDeep rescoring (selected as the rescoring selects it).
- **Delta masses of open search.** OMS `psm_metavalues` `DeltaMass` per PSM; the aggregate tables in the mod TSVs.

## What the app must pass

`-qpx_spectra` and `-keep_decoys` always; `-out_merged` for two or more inputs (the pooled proteins); FDR:PSM > 0
(q-values without Percolator); `-out_mod_analysis_dir` in open search. With ONNX Runtime missing in a build, the
`predicted_*` columns are null and the PSM view shows the theoretical spectrum only.
