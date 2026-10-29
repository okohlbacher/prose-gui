// The checks of New search in one place (guidance G10): what keeps the search from starting, what it should
// know before it starts, and what is only worth a note. Each check has an id, a level, its sentence, where it
// comes from and, where there is one, what fixes it. The plan line, the badges of the design table and the
// diagnosis of a result read them from here, so that one problem is worded once.
//
// Levels: `block` stops Start (a file ProSE cannot read, no database, a setting ProSE refuses); a red flag is
// a block the user may override ("Search anyway": profile MS2 spectra, no MS2 spectra), remembered per file on
// this computer and recorded with the search; `warn` and `info` never stop it. A preset can mark checks as
// expected (`Preset.expected`): an ion-trap preset expects low identification rates, an immunopeptidomics one
// a non-specific digest; those checks are then left out.

/** How much a check holds the search up. */
export type CheckLevel = 'block' | 'warn' | 'info'

/** What a check looks at. */
export type CheckSource = 'files' | 'spectra' | 'design' | 'sdrf' | 'database' | 'settings' | 'tool'

/** What fixes a check, as a button. */
export type CheckAction = { label: string; run: () => void }

export type Check = {
  /** The kind of check, stable across versions: what an override and a preset's `expected` name. */
  id: string
  level: CheckLevel
  /** A sentence (or two) for the user. */
  message: string
  source: CheckSource
  /** A red flag: it blocks Start, but the user may search anyway (once per file, see `AcceptedChecks`). */
  overridable?: boolean
  /** The input files it is about, by path: the design table marks them, an override accepts it for them. */
  files?: string[]
  action?: CheckAction
}

/** A red flag the user searched anyway, as the search's record keeps it (search.json `accepted`). */
export type AcceptedCheck = { id: string; files: string[]; message: string }

/** What the start checks look at: the form, its database, the SDRF, the settings and the tool, as plain values. */
export type StartState = {
  files: { path: string; name: string; problem: string | null }[]
  adding: boolean
  sdrfProblem: string | null
  /** The first design cell that is not valid, and how many more there are. */
  invalidCell: { label: string; text: string; more: number } | null
  database: { name: string; error: string | null; counted: boolean; problem: string | null } | null
  /** The sentence of the first inverted range, of the first value out of bounds (null: none). */
  inverted: string | null
  outside: string | null
  /** A PSM FDR is needed (the search has decoys) and is not above 0. */
  psmFdrMissing: boolean
  unknownMods: string | null
  toolError: string | null
}

/**
 * The checks that keep the search from starting, in the order New search names them (the first one is the plan
 * line's): files, the SDRF, the files' problems, the design, the database, the settings, the tool.
 */
export function startChecks(s: StartState): Check[] {
  const out: Check[] = []
  const block = (id: string, source: CheckSource, message: string, files?: string[]) =>
    out.push({ id, level: 'block', source, message, ...(files ? { files } : {}) })
  if (s.files.length === 0) block('no-files', 'files', 'Add spectrum files (mzML, mzPeak, Thermo .raw, Bruker .d) to start.')
  if (s.adding) block('adding', 'files', 'Adding files…')
  if (s.sdrfProblem) block('sdrf', 'sdrf', s.sdrfProblem)
  const unsearchable = s.files.filter((f) => f.problem)
  if (unsearchable.length === 1) block('file-problem', 'files', `${unsearchable[0].problem} Remove it to start the search.`, [unsearchable[0].path])
  if (unsearchable.length > 1) {
    block(
      'file-problem',
      'files',
      `${unsearchable.length} files cannot be searched (see Spectra). Remove them to start the search.`,
      unsearchable.map((f) => f.path),
    )
  }
  if (s.invalidCell) {
    const c = s.invalidCell
    const more = c.more > 0 ? ` (and ${c.more} more)` : ''
    block('design-cell', 'design', `${c.label}${more}: “${c.text}” is not a whole number of at least 1. Correct it, or empty the cell.`)
  }
  const db = s.database
  if (!db) block('no-database', 'database', 'Choose a FASTA database to start.')
  else if (db.error) block('database-error', 'database', `${db.name} cannot be read (${db.error}). Choose it again, or another FASTA file.`)
  else if (!db.counted) block('database-counting', 'database', 'Counting the proteins of the database…')
  else if (db.problem) block('database-problem', 'database', `${db.problem} Choose another FASTA file.`)
  if (s.inverted) block('range-inverted', 'settings', s.inverted)
  if (s.outside) block('range-outside', 'settings', s.outside)
  if (s.psmFdrMissing) block('psm-fdr', 'settings', 'Set a PSM FDR above 0 %.')
  if (s.unknownMods) block('unknown-modification', 'settings', s.unknownMods)
  if (s.toolError) block('tool', 'tool', `ProSE cannot be run: ${s.toolError}`)
  return out
}

/** The key of an accepted red flag for one file. */
const keyOf = (id: string, path: string) => `${id}\u0000${path}`

/** A red flag the user accepted for every file it is about. */
export function isAccepted(check: Check, accepted: ReadonlySet<string>): boolean {
  if (!check.overridable) return false
  const files = check.files ?? []
  return files.length > 0 ? files.every((p) => accepted.has(keyOf(check.id, p))) : accepted.has(keyOf(check.id, ''))
}

/** The checks without those the preset expects (`Preset.expected`); a block that is not a red flag always stays. */
export function withoutExpected(checks: Check[], expected: readonly string[] = []): Check[] {
  if (expected.length === 0) return checks
  const set = new Set(expected)
  return checks.filter((c) => !(set.has(c.id) && (c.level !== 'block' || c.overridable)))
}

/** The first check that stops Start (a red flag the user accepted does not). */
export function firstBlock(checks: Check[], accepted: ReadonlySet<string>): Check | null {
  return checks.find((c) => c.level === 'block' && !isAccepted(c, accepted)) ?? null
}

/** The red flags of `checks` the user accepted, as the search's record keeps them. */
export function acceptedOf(checks: Check[], accepted: ReadonlySet<string>): AcceptedCheck[] {
  return checks.filter((c) => isAccepted(c, accepted)).map((c) => ({ id: c.id, files: c.files ?? [], message: c.message }))
}

/** What the accepted red flags need of localStorage (an in-memory one in the tests). */
export type AcceptedStorage = Pick<Storage, 'getItem' | 'setItem'>

/** Where the accepted red flags are kept: per file and check, on this computer, so that the user is asked once. */
export const ACCEPTED_KEY = 'prose.accepted-checks'

function appStorage(): AcceptedStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null // blocked storage
  }
}

/** The accepted red flags of this computer (none if the storage is blocked or holds something else). */
export function loadAccepted(storage: AcceptedStorage | null = appStorage()): Set<string> {
  try {
    const list: unknown = JSON.parse(storage?.getItem(ACCEPTED_KEY) ?? '[]')
    return new Set(Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : [])
  } catch {
    return new Set()
  }
}

/** `accepted` with the red flag `check` accepted for its files, kept in `storage`. */
export function accept(check: Check, accepted: ReadonlySet<string>, storage: AcceptedStorage | null = appStorage()): Set<string> {
  const next = new Set(accepted)
  const files = check.files ?? []
  for (const p of files.length > 0 ? files : ['']) next.add(keyOf(check.id, p))
  try {
    storage?.setItem(ACCEPTED_KEY, JSON.stringify([...next]))
  } catch {
    // (a full or blocked storage: accepted for this session only)
  }
  return next
}

/** The accepted red flags of a saved search (its record), for New search when the search is opened there again. */
export function acceptedKeys(list: AcceptedCheck[]): string[] {
  return list.flatMap((a) => (a.files.length > 0 ? a.files : ['']).map((p) => keyOf(a.id, p)))
}

/**
 * Instrument models (PSI-MS names of an mzML's header) that record MS2 in an ion trap only: their fragments are
 * low-resolution (about 0.5 Da), so a ppm fragment tolerance misses most of them. Hybrids (LTQ Orbitrap, Orbitrap
 * Fusion) can record MS2 either way: for them the analyzer of the MS2 scans decides (`ms2Analyzer`, from the
 * spectrum inspector).
 */
export const ION_TRAP_MODELS = /^(LCQ\b.*|LXQ|LTQ|LTQ XL|LTQ Velos|Velos Pro|amaZon\b.*|HCT\b.*|esquire\b.*|Bruker amaZon.*)$/i

/** The fragment tolerance the ion-trap check offers (the ion-trap preset's, `presets.ts`). */
export const ION_TRAP_FRAGMENT_DA = 0.5

/**
 * The advice for files measured in an ion trap with a ppm fragment tolerance (guidance G3): ProSE then matches
 * almost no fragments. `instrument` is the header's model name, `ms2Analyzer` the inspector's (e.g. 'ion trap').
 */
export function ionTrapPpm(
  files: { path: string; name: string; instrument?: string | null; ms2Analyzer?: string | null }[],
  fragmentUnit: string,
  setDa: () => void,
): Check | null {
  if (fragmentUnit !== 'ppm') return null
  const trap = files.filter((f) => (f.ms2Analyzer ? /ion trap/i.test(f.ms2Analyzer) : ION_TRAP_MODELS.test(f.instrument ?? '')))
  if (trap.length === 0) return null
  const which = trap.length === files.length ? (files.length === 1 ? trap[0].name : 'All files') : `${trap.length} of ${files.length} files`
  return {
    id: 'iontrap-ppm',
    level: 'warn',
    source: 'settings',
    files: trap.map((f) => f.path),
    message:
      `${which} ${trap.length === 1 && files.length === 1 ? 'was' : 'were'} measured with ion-trap MS2 (low-resolution fragments), but the fragment ` +
      `tolerance is in ppm: ProSE would match few fragments. Ion-trap fragments need about ${ION_TRAP_FRAGMENT_DA} Da.`,
    action: { label: `Use ${ION_TRAP_FRAGMENT_DA} Da`, run: setDa },
  }
}
