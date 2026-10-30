// The download of a UniProt proteome as the database (Protein database › Download, and a project whose proteome is
// no longer on disk): one at a time, its state shared so that the card shows it whichever of the two started it.

import { downloadProteome } from '../desktop'
import { searchForm } from './form.svelte'

/** The proteome being downloaded (null: none) and why the last download failed (null: it did not). */
export const proteomeDownload = $state<{ id: string | null; error: string | null }>({ id: null, error: null })

/**
 * Downloads UniProt proteome `id` (Swiss-Prot entries only if `reviewed`) into the app's databases folder and
 * chooses it as the database, unless another FASTA was chosen while it downloaded. -> its path; throws (with the
 * error also in `proteomeDownload.error`) if the download failed.
 */
export async function fetchProteome(id: string, reviewed: boolean): Promise<string> {
  proteomeDownload.error = null
  proteomeDownload.id = id
  try {
    const before = searchForm.database
    const path = await downloadProteome(id, reviewed)
    // (a FASTA chosen while it downloaded stays chosen)
    if (searchForm.database === before) await searchForm.setDatabase(path)
    return path
  } catch (e) {
    proteomeDownload.error = String((e as Error)?.message ?? e)
    throw e
  } finally {
    proteomeDownload.id = null
  }
}
