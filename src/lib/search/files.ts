// What kind of input a path is, by its name: the shim searches mzML (`.mzML`, `.mzML.gz`), mzPeak, Thermo
// `.raw` and Bruker `.d` folders, and reads the database from `.fasta`, `.fa` or `.faa` (src-tauri/src/args.rs).
// The sizes and counts New search shows come from the shim (`inspect_files`), which reads the files where they are.

export const isSpectrum = (name: string) => /\.(mzml(\.gz)?|mzpeak|raw|d)$/i.test(name)
export const isFasta = (name: string) => /\.(fasta|fa|faa)$/i.test(name)

/** A Bruker .d folder chosen by its analysis.tdf (or analysis.tdf_bin) in the file dialog is the folder; other paths as they are. */
export const brukerFolder = (path: string) => path.replace(/([\\/][^\\/]+\.d)[\\/]analysis\.tdf(_bin)?$/i, '$1')

/** An SDRF or OpenMS design.tsv, by its name (read as a design, not added as a file). */
export const isDesign = (name: string) => /\.(tsv|txt|sdrf)$/i.test(name)
