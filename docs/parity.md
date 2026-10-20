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
      -out_qpx <dir>/qpx -out_psm_spectra <dir>/spectra -out_parquet <dir>/oms -summary_out <dir>/summary.yaml
      -keep_decoys
      [-out_merged <dir>/merged.idXML]                  (two or more inputs)
      [-out_mod_analysis_dir <dir>/mods]                 (open search)
```

| Short name | File | Content |
| --- | --- | --- |
| QPX psm | `qpx/<stem>.psm.parquet` (per input; `qpx/quantms.psm.parquet` concatenates them) | one row per written PSM (best hit of a spectrum), the QPX psm view (schema unchanged) |
| PSM spectra | `spectra/<stem>.psm_spectra.parquet` (per input; new in #10676) | sidecar of the QPX psm view, one row per QPX psm row: `psm_id` (int64, the QPX key) and `peak_mz_array`, `peak_intensity_array`, `predicted_ion_type_array`, `predicted_mz_array`, `predicted_intensity_array` |
| OMS psm | `oms/<stem>.psm.parquet` (`oms/openms.psm.parquet` concatenates them) | the same rows in OpenMS' internal schema: `spectrum_reference`, `score`/`score_type`, `additional_scores`, `psm_metavalues`, `protein_accessions` (with `start`/`end`) |
| OMS proteins, pg | `oms/<stem>.proteins.parquet`, `oms/<stem>.pg.parquet` | protein hits and groups of the file's run (inferred only with protein FDR on one input) |
| merged proteins, pg | `oms/merged.proteins.parquet`, `oms/merged.pg.parquet` | proteins and groups of the pooled inference and protein FDR of `-out_merged` (new in #10676) |
| OMS search params | `oms/<stem>.search_params.parquet` | run settings, run meta values (`peptdeep_nce`), `extra_features` |
| YAML | `summary.yaml` | end-of-search report: `shared`, `per_file[]`, `outputs`, `protein_fdr_applied` |
| mod TSV | `mods/<stem>_ModificationAnalysis_{DeltaMassStats,PTMStats}.tsv`, `mods/_aggregate_across_files_…` | open-search modification analysis (header lines `# Total PSMs: …` and a table) |
| FASTA | the database the app passed | protein descriptions and sequences |

All Parquet files are Zstandard-compressed (Arrow C++): the reader needs a Zstandard decoder (hyparquet has Snappy
only). The FASTA is the folder's `database.fasta` with contaminants; without them ProSE searched the user's file, whose
path is summary.yaml's `shared.database_file` (absolute, outside the search folder).

Rows: the PSM rows of `ResultTables.psms` are the QPX psm rows of the files in input order (QPX psm, OMS psm and the
PSM spectra sidecar have the same rows in the same order, one per peptide identification with hits; the sidecar and
QPX psm also share the key `psm_id`). The QPX `scan` is the native ID's scan number only, so rows are joined to OMS psm
by position (or by `run_file_name` + `scan` + `peptidoform` + `charge`). The reader joins OMS psm by position and the
sidecar by `psm_id` (`src/lib/results/read.ts`).

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
| `psms.score` | Percolator's SVM score: OMS `psm_metavalues` `percolator_score` (QPX `additional_scores` `MS:1001492`); without rescoring ProSE's ln(hyperscore): the `additional_scores` entry `ln(hyperscore)` (named `ln(hyperscore)_score` once the FDR made the q-value the main score), or OMS `score` while `score_type` is `ln(hyperscore)`. A hit Percolator could not rescore: −100 (as in the output). The QPX `additional_scores` are doubles; the OMS `psm_metavalues` are text rounded to 15–17 digits, so the reader takes a score from QPX first | available (pick by name) |
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
| `peptides.modMass` | the modification's monoisotopic mass delta: from the app's modification table (Unimod accession → mass, else name → mass), or the mass of a mass-only name. The table is **generated from the pin's Unimod file (`share/OpenMS/CHEMISTRY/unimod.xml` of `native/OPENMS_COMMIT`, which ModificationsDB reads) by `scripts/unimod-table.mjs` into `src/lib/chemistry/unimod.json` (committed; regenerate with the pin)**: record id → name, `delta mono_mass`. Task 4 generates names and masses only; the sites the settings form needs are to be added to it; the settings form lists its modifications from the same table (the web app took them from the WASM module's `validStrings` of `modifications:fixed`/`variable`) | derived in the UI (no output carries it; the TypeScript fragment annotation needs the same table) |
| `peptides.proteinOffsets`, `peptides.protein` | OMS psm `protein_accessions[].accession` of the peptide's first PSM, kept where the protein is in the proteins table (see `proteins`); none left → "below protein FDR" | derived in the UI |
| `peptides.start`, `peptides.end` | OMS `protein_accessions[].start` / `end` (0-based, `end` inclusive → `end` + 1); the web app's check against the sequence (FASTA) | available (+1) |
| `proteins.count`, `proteins.accession` | one input: OMS `<stem>.proteins.parquet`; several inputs: `merged.proteins.parquet` (pooled inference); without protein inference (no protein FDR, one input) the per-file protein hits | available; for several inputs **added in #10676** |
| `proteins.description` | OMS proteins `description` if set, else the FASTA header; a generated decoy has the description of its target (as the web app: it looks the decoy up by its target's accession) | derived in the UI (the FASTA is read anyway) |
| `proteins.sequence` | FASTA; a decoy ProSE generated: the reversal ProSE uses (`DecoyGenerator::reversePeptides` for the search's enzyme, `reverseProtein` for `enzyme_specificity none`, initial M kept with `peptide:clip_nterm_methionine`), as the web app's engine regenerated it | derived in the UI (port of the decoy rule; until then '' for generated decoys, which the web app's type allows) |
| `proteins.score` | best `psms.score` of the protein's PSMs | derived in the UI (as the web app) |
| `proteins.qValue` | OMS proteins `score` when the protein FDR was applied (YAML `protein_fdr_applied`; protein score type `q-value`); else NaN | available; for several inputs **added in #10676** |
| `proteins.decoy` | OMS proteins `is_decoy` | available |
| `proteins.group` | index of the `indistinguishable` group in OMS `<stem>.pg.parquet` / `merged.pg.parquet` (`accessions`, `group_index`); −1 if none. **One input without protein FDR: the tool infers no proteins and its `<stem>.pg.parquet` is empty, so every protein is −1, where the web app has a group per protein** (its pooled run of one file); the web app's screens count a protein without a group as a group of its own | available; for several inputs **added in #10676**; one input without protein FDR: none |

## StoredSpectra

| Field | Source | Verdict |
| --- | --- | --- |
| `psmSpectrum` | one spectrum per PSM row: the row's own peaks (index = row; PSMs of one spectrum are separate rows with the same peaks) | **added in #10676** (`-out_psm_spectra`) |
| `offsets`, `mz`, `intensity` | PSM spectra sidecar `peak_mz_array`, `peak_intensity_array` (float32, every peak of the MS2 spectrum as read from the file, by m/z; null when the spectrum was not found or the file could not be read again) | **added in #10676** |
| `precursorMz` | OMS `observed_mz` of the row | available |
| `collisionEnergy` | — (the reader fills NaN) | not needed: the web app used it only as a fallback NCE for predicting in the browser; the desktop app shows ProSE's prediction (QPX `predicted_*`), made at the file's `peptdeep_nce` |

The PeptDeep prediction for the PSM view (the web app's `predictMS2()` result) is in the sidecar's
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
| `files[].path` | the app's input path (YAML `per_file[].input_file` is its basename) | available |
| `files[].status` | YAML `per_file[].exit_code` (0 `EXECUTION_OK`, 1 `INPUT_FILE_EMPTY`, 2 `UNEXPECTED_RESULT`, 3 `UNKNOWN_ERROR`, 4 `ILLEGAL_PARAMETERS`) | available (enum map) |
| `files[].ms2Spectra` | YAML `per_file[].ms2_spectra` | available |
| `files[].targetPSMs`, `decoyPSMs` | YAML `per_file[].target_psms`, `decoy_psms` (after the FDR filters; with `-keep_decoys` the decoys that pass) | available |
| `files[].percolator` | YAML `per_file[].percolator.applied`, `skipped_reason`, `warning` ('' → null); `null` when the search ran with `Search:rescore false`, which the YAML shows as `applied: false` with an empty `skipped_reason` | **added in #10676** |
| `files[].peptdeepNce` | YAML `per_file[].peptdeep_nce` (the NCE of the file's predictions; also the run meta value `peptdeep_nce` in OMS search params) | **added in #10676** (before: only with `peptdeep:enable`, and only in the search params) |
| `files[].precursorError`, `fragmentError` | YAML `per_file[].precursor_error` / `fragment_error` (`median_ppm`, `mad_ppm`, `recommended_ppm`; `valid: false` → null), with six significant digits (the web app has the doubles) | available |
| `files[].secondsSearch` | YAML `per_file[].timing_seconds.search` | available |
| `search.databaseFile`, `enzyme`, `openSearch`, `chunked`, `decoyMode`, `indexedPeptides`, `indexedFragments`, `secondsIndexBuild`, `secondsTotal` | YAML `shared.database_file`, `enzyme`, `open_search`, `chunked`, `decoy_mode`, `indexed_peptides`, `indexed_fragments`, `seconds_index_build`, `seconds_total` | available |
| `search.calibration` | YAML `shared.calibration_enabled` | available |
| `search.targetProteins`, `decoyProteins` | YAML `shared.db_target_proteins`, `db_decoy_proteins` | available |
| `proteinFdrApplied` | YAML `protein_fdr_applied` | **added in #10676** |
| `psmFdr`, `proteinFdr` | YAML `shared.psm_fdr_threshold`, `protein_fdr_threshold` | available |
| `decoyString` | OMS search params `sp_metavalues` `PeptideIndexer:decoy_string` (`DECOY_`; position `PeptideIndexer:decoy_string_position`); the web app's screens do not use it (decoys are flagged per row: `is_decoy`), but the type has it | available |
| `openSearch` | YAML `shared.open_search` | available |
| `modificationAnalysis` | null in closed search; one input: the file's mod TSVs; several: the `_aggregate_across_files` TSVs | available |
| ↳ `deltaMasses.totalPSMs`, `modifiedPSMs`, `unmodifiedPSMs`, `meanDeltaMass`, `medianDeltaMass` | DeltaMassStats header lines `# Total PSMs:`, `# Modified PSMs:`, `# Unmodified PSMs:`, `# Mean Delta Mass:`, `# Median Delta Mass:` | available |
| ↳ `deltaMasses.entries[]` | DeltaMassStats rows: `DeltaMass`, `Count`, `UniquePeptides`, `ChargeStates`, `Percentage`, `MappedModification`, `IsKnown` | available |
| ↳ `ptms.totalModifiedPSMs`, `unknownModificationPSMs`, `uniqueModifications` | PTMStats header lines | available |
| ↳ `ptms.entries[]` `name`, `theoreticalMass`, `observedMass`, `massDeviation`, `count`, `uniquePeptides`, `percentage`, `targetResidues` | PTMStats columns (the TSVs have six significant digits, the web app the doubles) | available |
| ↳ `ptms.entries[].chargeStates` | — (PTMStats has no charge column; the reader fills 0) | not needed: the web app's screens do not show it |
| ↳ `ptms.entries[].residueCounts` | PTMStats `ResidueFrequency` (`A:4,D:2,…`; equals the web app's) | available (the web app does not show it: `delta-mass.ts` counts every residue of the peptides) |

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
  come from the app's modification table, generated at build time from the pin's ModificationsDB/unimod.xml (no
  output has them).
- **NCE per file.** YAML `per_file[].peptdeep_nce` and the run meta value `peptdeep_nce` — added in #10676 for every
  file with predictions, also without PeptDeep rescoring (then selected by PeptDeep rescoring run on a copy of the
  written PSMs; `peptdeep:nce` if set).
- **Delta masses of open search.** OMS `psm_metavalues` `DeltaMass` per PSM; the aggregate tables in the mod TSVs.

## What the app must pass

`-out_psm_spectra` and `-keep_decoys` always; `-out_merged` for two or more inputs (the pooled proteins); FDR:PSM > 0
(q-values without Percolator); `-out_mod_analysis_dir` in open search. Inputs must have distinct file names (stems,
`a.mzML` and `a.mzML.gz` included): ProSE refuses two inputs of the same name in different folders (exit code 6), as
their per-input outputs would overwrite each other; the app has to say so before it starts. `.mzML.gz` inputs work
(the sidecar's peaks equal those of the uncompressed file). The sidecar of an input is written as soon as that input is
done. A failed re-read or prediction leaves null columns and a warning in the log, never a failed search; with ONNX
Runtime missing in a build, the `predicted_*` columns are null and the PSM view shows the theoretical spectrum only.
