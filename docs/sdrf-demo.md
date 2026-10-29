# Trying the SDRF features

Demo files: `/Users/kohlbach/Claude/OpenMS - ProSE/data/sdrf-demo` (on Oliver's MacBook):
`ecoli.sdrf.tsv` with `Ecoli_1.mzML` and `Ecoli_2.mzML` (copies of OpenMS' Ecoli_MS2_small.mzML), and
`PXD000001_community_annotated.sdrf.tsv` (from PRIDE).

Start the app from this worktree with `npm run tauri dev`.

1. **Load and resolve.** New search → Load SDRF… → `ecoli.sdrf.tsv`. Ecoli_1 is found, Ecoli_2 is found as
   mzML (the SDRF names Ecoli_2.raw), Ecoli_3.mzML is missing and blocks Start.
2. **Create SDRF.** Remove all, add `Ecoli_1.mzML` and `Ecoli_2.mzML` by hand, set a condition, then
   Create SDRF…. The panel lists organism, organism part, disease and cell type as to fill in.
3. **Metadata editor.** Edit metadata… → type "liver" in characteristics[organism part] (OLS lookup), pick
   Escherichia coli for the organism, select rows and use ↓ to apply a value, add the `human` or
   `ms-proteomics` template's columns, Validate with sdrf-pipelines. Change factor value[condition] here:
   the design table's Condition follows. Save SDRF….
4. **PRIDE download.** Load SDRF… → `PXD000001_community_annotated.sdrf.tsv`. Its one data file
   (TMT_Erwinia_…_01.raw, 220 MB) is missing; the PRIDE project field shows PXD000001 (from the file name).
   Download missing… → choose a folder. Progress shows in the panel, Cancel stops it, starting again
   resumes it. Afterwards the file is found (ProSE reads .raw directly).
5. **After a search.** Results → Samples shows the SDRF's characteristics and factor values;
   Export → SDRF writes it with the search's settings filled in.
