// Projects: the setup of a search and the state of the views as one JSON file, `<name>.prose-setup.json`, from
// which the search can be set up again and the app shows what it showed (File › Save Project, Open Project). Not the
// results archive (`.prose`, Export › Results archive: a zip of a finished search's outputs, history.ts): a project
// holds no results, only paths, settings and view state, and names the History search it ran as, if any.
//
// The format (schema 1). Every path is absolute, as on the computer that saved it; the sizes are bytes, to tell a
// file that changed since. Fields not listed are ignored when read; a field left out takes its default.
//
//   format        "prose-setup" (what the file is)
//   schema        1 (a newer schema is refused: made by a newer ProSE)
//   savedAt       ISO time of the save
//   appVersion    the version of the app that saved it
//   proseVersion  the version of the ProSE tool it had (null: unknown)
//   name          the project's name (its file name without .prose-setup.json)
//   inputs        the spectrum files in the design table's order: { path, name, size, condition?, replicate?,
//                 fraction?, techReplicate? } (the design fields as entered; left out: not entered)
//   database      the FASTA: { path, name, size, proteome } (proteome: the UniProt proteome id of a downloaded one,
//                 UP + 9 digits, else null), or null (none chosen)
//   contaminants  add the cRAP contaminants
//   decoys        the decoys setting (ProSE's `decoys`: "generate", "ignore", ...), also among `parameters`
//   presetId      the preset the settings are shown against
//   parameters    ProSE's `Search:` parameters as the form has them (the preset's and the user's), by name
//   rescore       Percolator; peptdeep: PeptDeep's predictions
//   threads       the search's threads (null: all cores)
//   sdrf          the SDRF loaded: { path } (read again from there), or null
//   search        the History search this setup ran as: { id, name } (null: none yet)
//   ui            the views: { view ("search", "results", "history", "help"), helpPage?, showSettings, advanced,
//                 results: null or { tab, showTechReplicates, panel, panelTab, panelPeptide, psm, levels:
//                 { proteins, peptides, psms: { filters, sort, hidden, selected } } } } (rows by their index in the
//                 search's tables; filters as results/filters.ts `FilterState`, NaN written as null)

import { HELP_PAGES, views, type HelpPage, type View } from '../route'
import type { FilterState } from '../results/filters'
import type { Level } from '../results/model'
import type { PanelTab, SortState, Tab } from '../results/view.svelte'

export const SETUP_FORMAT = 'prose-setup'
export const SETUP_SCHEMA = 1
export const SETUP_EXTENSION = '.prose-setup.json'

export type SetupInput = {
  path: string
  name: string
  size: number
  condition?: string
  replicate?: number
  fraction?: number
  techReplicate?: number
}

export type SetupLevel = { filters: FilterState; sort: SortState; hidden: string[]; selected: number | null }

export type ResultsUi = {
  tab: Tab
  showTechReplicates: boolean
  panel: number | null
  panelTab: PanelTab
  panelPeptide: number | null
  psm: number | null
  levels: Record<Level, SetupLevel>
}

export type SetupUi = {
  view: View
  helpPage?: HelpPage
  showSettings: boolean
  advanced: boolean
  results: ResultsUi | null
}

export type ProjectSetup = {
  format: typeof SETUP_FORMAT
  schema: number
  savedAt: string
  appVersion: string
  proseVersion: string | null
  name: string
  inputs: SetupInput[]
  database: { path: string; name: string; size: number; proteome: string | null } | null
  contaminants: boolean
  decoys: string | null
  presetId: string
  parameters: Record<string, unknown>
  rescore: boolean
  peptdeep: boolean
  threads: number | null
  sdrf: { path: string } | null
  search: { id: string; name: string } | null
  ui: SetupUi
}

/** A project file that cannot be used; the message says why. */
export class SetupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SetupError'
  }
}

/** The UniProt proteome id of a downloaded proteome's file name (`UP000005640_reviewed.fasta`), else null. */
export function proteomeOf(name: string): string | null {
  return /^(UP\d{9})(?:_reviewed)?\.fasta$/.exec(name)?.[1] ?? null
}

/** The project's name from a file name (`exp.prose-setup.json` -> `exp`). */
export function setupName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName
  return base.toLowerCase().endsWith(SETUP_EXTENSION) ? base.slice(0, -SETUP_EXTENSION.length) : base.replace(/\.json$/i, '')
}

/** The JSON of a setup, two-space indented (NaN and infinite numbers, which JSON has not, as null). */
export function serializeSetup(setup: ProjectSetup): string {
  return JSON.stringify(setup, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v), 2) + '\n'
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)

/** A filter state as written (null for NaN): `maxQ` null is NaN again (the search's own cutoff). */
function filtersOf(v: unknown): FilterState | null {
  if (!isObject(v)) return null
  const f = { ...v } as Record<string, unknown>
  f.maxQ = typeof f.maxQ === 'number' ? f.maxQ : NaN
  if (Array.isArray(f.ranges)) {
    f.ranges = f.ranges.filter(isObject).map((r) => ({ ...r, min: num(r.min) ?? -Infinity, max: num(r.max) ?? Infinity }))
  }
  return f as unknown as FilterState
}

function levelOf(v: unknown): SetupLevel | null {
  if (!isObject(v)) return null
  const filters = filtersOf(v.filters)
  const sort = isObject(v.sort) && typeof v.sort.key === 'string' && (v.sort.dir === 'asc' || v.sort.dir === 'desc') ? (v.sort as SortState) : null
  if (!filters || !sort) return null
  return {
    filters,
    sort,
    hidden: Array.isArray(v.hidden) ? v.hidden.filter((h): h is string => typeof h === 'string') : [],
    selected: num(v.selected) ?? null,
  }
}

function resultsUiOf(v: unknown): ResultsUi | null {
  if (!isObject(v) || !isObject(v.levels)) return null
  const levels = { proteins: levelOf(v.levels.proteins), peptides: levelOf(v.levels.peptides), psms: levelOf(v.levels.psms) }
  if (!levels.proteins || !levels.peptides || !levels.psms) return null
  const tabs: Tab[] = ['overview', 'proteins', 'peptides', 'psms', 'samples', 'qc']
  const panelTabs: PanelTab[] = ['coverage', 'peptides', 'psms']
  return {
    tab: tabs.includes(v.tab as Tab) ? (v.tab as Tab) : 'proteins',
    showTechReplicates: bool(v.showTechReplicates, false),
    panel: num(v.panel) ?? null,
    panelTab: panelTabs.includes(v.panelTab as PanelTab) ? (v.panelTab as PanelTab) : 'peptides',
    panelPeptide: num(v.panelPeptide) ?? null,
    psm: num(v.psm) ?? null,
    levels: levels as Record<Level, SetupLevel>,
  }
}

/**
 * The setup of a project file's text, checked: JSON, `format` "prose-setup", a schema this app reads, inputs with a
 * path each. Throws a SetupError that says what is wrong; a newer schema is refused, not guessed at.
 */
export function parseSetup(text: string): ProjectSetup {
  let raw: unknown
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''))
  } catch (e) {
    throw new SetupError(`This is not a project file: it is not JSON (${(e as Error).message}).`)
  }
  if (!isObject(raw) || raw.format !== SETUP_FORMAT) throw new SetupError('This is not a ProSE project file (no "format": "prose-setup").')
  const schema = raw.schema
  if (typeof schema !== 'number' || !Number.isInteger(schema) || schema < 1) throw new SetupError('This project file has no valid schema version.')
  if (schema > SETUP_SCHEMA) {
    throw new SetupError(
      `This project was saved by a newer ProSE (project schema ${schema}; this app reads up to ${SETUP_SCHEMA}${typeof raw.appVersion === 'string' ? `, saved by app ${raw.appVersion}` : ''}). Update the app to open it.`,
    )
  }
  if (!Array.isArray(raw.inputs)) throw new SetupError('This project file has no list of inputs.')
  const inputs: SetupInput[] = raw.inputs.map((i, k) => {
    if (!isObject(i) || typeof i.path !== 'string' || i.path === '') throw new SetupError(`Input ${k + 1} of the project file has no path.`)
    const input: SetupInput = { path: i.path, name: str(i.name, i.path.split(/[\\/]/).pop() ?? i.path), size: num(i.size) ?? 0 }
    if (typeof i.condition === 'string') input.condition = i.condition
    for (const f of ['replicate', 'fraction', 'techReplicate'] as const) if (num(i[f]) !== undefined) input[f] = num(i[f])
    return input
  })
  const db = raw.database
  const database =
    isObject(db) && typeof db.path === 'string' && db.path !== ''
      ? { path: db.path, name: str(db.name, db.path.split(/[\\/]/).pop() ?? db.path), size: num(db.size) ?? 0, proteome: typeof db.proteome === 'string' ? db.proteome : null }
      : null
  const ui = isObject(raw.ui) ? raw.ui : {}
  const view = (views as readonly string[]).includes(ui.view as string) ? (ui.view as View) : 'search'
  const search = isObject(raw.search) && typeof raw.search.id === 'string' && raw.search.id !== '' ? { id: raw.search.id, name: str(raw.search.name, raw.search.id) } : null
  return {
    format: SETUP_FORMAT,
    schema,
    savedAt: str(raw.savedAt, ''),
    appVersion: str(raw.appVersion, ''),
    proseVersion: typeof raw.proseVersion === 'string' ? raw.proseVersion : null,
    name: str(raw.name, 'project'),
    inputs,
    database,
    contaminants: bool(raw.contaminants, true),
    decoys: typeof raw.decoys === 'string' ? raw.decoys : null,
    presetId: str(raw.presetId, ''),
    parameters: isObject(raw.parameters) ? raw.parameters : {},
    rescore: bool(raw.rescore, true),
    peptdeep: bool(raw.peptdeep, false),
    threads: num(raw.threads) !== undefined && num(raw.threads)! > 0 ? Math.round(num(raw.threads)!) : null,
    sdrf: isObject(raw.sdrf) && typeof raw.sdrf.path === 'string' && raw.sdrf.path !== '' ? { path: raw.sdrf.path } : null,
    search,
    ui: {
      view,
      ...((HELP_PAGES as readonly string[]).includes(ui.helpPage as string) ? { helpPage: ui.helpPage as HelpPage } : {}),
      showSettings: bool(ui.showSettings, false),
      advanced: bool(ui.advanced, false),
      results: resultsUiOf(ui.results),
    },
  }
}

/** What a file of the project is now: there with its size, or why it cannot be read (`inspect_files`). */
export type FoundFile = { path: string; size: number; error: string | null }

/**
 * The project's files (inputs, then the database) that are no longer there, and those whose size changed since the
 * save (a size of 0 was not known then, and is not compared), by name.
 */
export function checkFiles(
  expected: { path: string; name: string; size: number }[],
  found: FoundFile[],
): { missing: string[]; changed: { name: string; was: number; now: number }[] } {
  const byPath = new Map(found.map((f) => [f.path, f]))
  const missing: string[] = []
  const changed: { name: string; was: number; now: number }[] = []
  for (const e of expected) {
    const f = byPath.get(e.path)
    if (!f || f.error !== null) missing.push(e.name)
    else if (e.size > 0 && f.size !== e.size) changed.push({ name: e.name, was: e.size, now: f.size })
  }
  return { missing, changed }
}
