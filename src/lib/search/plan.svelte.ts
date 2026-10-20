// What the New search form amounts to: the one-line plan, why the search cannot start yet, and starting
// it: the form's values become the shim's search request (paths, ProSE's parameters by the names the
// shim lets through, the rescoring switches, the threads).

import type { SearchRequest } from '../desktop'
import { formatPercent } from '../format/fdr'
import { navigate } from '../route.svelte'
import { unknownModifications } from '../settings/modifications'
import { copyValues, requestParameters } from '../settings/parameters'
import { PROSE_PARAMETERS } from '../settings/prose'
import { CRAP_PROTEINS, searchForm as form } from './form.svelte'
import { runSearch, searchRun } from './session.svelte'
import { toolState } from './tool.svelte'

function unknownMessage(names: string[]): string {
  return (
    `${names.length === 1 ? 'Unknown modification' : 'Unknown modifications'}: ${names.join(', ')}. ` +
    'ProSE does not know this name; choose one from the list.'
  )
}

class SearchPlan {
  /** PeptDeep features need Percolator and a ProSE with ONNX Runtime (unknown while the tool is asked). */
  peptdeep = $derived(form.rescore && form.peptdeep && (toolState.info?.onnx ?? true))

  /** "6 files in 3 samples · 20,652 proteins + 116 cRAP + decoys" */
  line = $derived.by(() => {
    const n = form.files.length
    if (n === 0) return form.adding > 0 ? 'Adding files…' : 'No spectra yet'
    const samples = form.design.samples.length
    const parts = [`${n} ${n === 1 ? 'file' : 'files'}${n > 1 ? ` in ${samples} ${samples === 1 ? 'sample' : 'samples'}` : ''}`]
    if (form.database) {
      const proteins = form.database.proteins
      const decoys = form.value('decoys') === 'ignore' ? '' : ' + decoys'
      const crap = form.contaminants ? ` + ${CRAP_PROTEINS} cRAP` : ''
      if (form.database.error) parts.push('the database cannot be read')
      else parts.push(proteins === null ? 'counting proteins…' : `${proteins.toLocaleString('en-US')} proteins${crap}${decoys}`)
    } else {
      parts.push('no database yet')
    }
    if (form.isExample) parts.push(`example: ${formatPercent(Number(form.value('FDR:protein')))} protein FDR, small database`)
    return parts.join(' · ')
  })

  /** The line in full (the footer may cut it). */
  lineTitle = $derived(this.line)

  /** (The web app's memory advice: none, the tool has no memory limit of its own.) */
  advice = $derived<{ text: string; over: boolean } | null>(null)

  /** Modification names ProSE does not know. */
  unknownMods = $derived(unknownModifications(form.values, PROSE_PARAMETERS))

  /** Why the search cannot start yet. */
  problem = $derived.by(() => {
    if (form.files.length === 0) return 'Add mzML files to start.'
    if (!form.database) return 'Choose a FASTA database to start.'
    if (form.database.error) return `${form.database.file.name} cannot be read (${form.database.error}). Choose it again, or another FASTA file.`
    if (!(Number(form.value('FDR:PSM')) > 0)) return 'Set a PSM FDR above 0 %.'
    if (!(Number(form.value('FDR:protein')) > 0)) return 'Set a protein FDR above 0 %.'
    if (this.unknownMods.length > 0) return unknownMessage(this.unknownMods)
    if (toolState.status === 'failed') return `ProSE cannot be run: ${toolState.error}`
    return null
  })

  /** The problem is shown in the footer (with files; without, the plan line says "No spectra yet"). */
  problemShown = $derived(this.problem !== null && form.files.length > 0)

  canStart = $derived(this.problem === null && searchRun.status !== 'running')
}

export const searchPlan = new SearchPlan()

/**
 * The shim's request for the form: the files and the database by path, the parameters that differ
 * from ProSE's defaults (by the names of the shim's allowlist), the rescoring switches and the threads
 * (0: all cores). Null without files or database.
 */
export function searchRequest(): SearchRequest | null {
  if (!form.database || form.files.length === 0) return null
  const values = $state.snapshot(form.values) as Record<string, unknown>
  return {
    files: form.files.map((r) => ({ id: r.id, path: r.file.path })),
    database: form.database.file.path,
    contaminants: form.contaminants,
    settings: {
      parameters: requestParameters(values, form.defaults),
      rescore: form.rescore,
      peptdeep: searchPlan.peptdeep,
      threads: form.threads ?? 0,
    },
  }
}

/** Starts the search of the form; on success, opens its result. */
export async function startSearch(): Promise<void> {
  const request = searchRequest()
  if (!searchPlan.canStart || !request || !form.database) return
  const values = $state.snapshot(form.values) as Record<string, unknown>
  const id = await runSearch(request, {
    design: $state.snapshot(form.design),
    psmFdr: Number(values['FDR:PSM']),
    proteinFdr: Number(values['FDR:protein']),
    settings: {
      parameters: request.settings.parameters,
      fixedMods: (values['modifications:fixed'] as string[] | undefined) ?? [],
      database: form.database.file.name,
      rescore: request.settings.rescore,
      peptdeep: request.settings.peptdeep,
      contaminants: form.contaminants,
      presetId: form.presetId,
    },
  })
  if (id !== null) navigate({ view: 'results', id })
}

/**
 * New search still holds the inputs of `result`: the same files, by name and order, and the same
 * database. It can then search them again with other settings. A result from History or a project
 * file has no files of its own, so it qualifies only when New search holds them again.
 */
export function canSearchAgain(result: { design: { rows: { fileName: string }[] }; settings: { database: string } }): boolean {
  const rows = result.design.rows
  return (
    form.database?.file.name === result.settings.database &&
    form.files.length === rows.length &&
    form.files.every((r, i) => r.file.name === rows[i].fileName)
  )
}

/**
 * Back to New search with the inputs and settings of `result`, changed by `changes` (parameters,
 * e.g. { 'FDR:protein': 0.05 }). The user starts the search there.
 */
export function searchAgain(
  result: { settings: { presetId?: string; parameters: Record<string, unknown>; rescore: boolean; peptdeep: boolean; contaminants: boolean } },
  changes: Record<string, unknown>,
): void {
  const s = result.settings
  if (s.presetId !== undefined && form.presets.some((p) => p.id === s.presetId)) form.presetId = s.presetId
  form.overrides = copyValues({ ...s.parameters, ...changes })
  form.rescore = s.rescore
  form.peptdeep = s.peptdeep
  form.contaminants = s.contaminants
  navigate({ view: 'search' })
}
