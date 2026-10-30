import { describe, expect, test } from 'vitest'
import { checkFiles, parseSetup, proteomeOf, serializeSetup, SETUP_SCHEMA, setupName, SetupError, type ProjectSetup } from './setup'

// The project file (`.prose-setup.json`) without the app: written and read back, its schema checked, and the files
// that are gone or changed since it was saved.

const setup = (): ProjectSetup => ({
  format: 'prose-setup',
  schema: SETUP_SCHEMA,
  savedAt: '2026-10-30T10:00:00.000Z',
  appVersion: '0.1.4',
  proseVersion: '3.7.0',
  name: 'exp',
  inputs: [
    { path: '/data/a.mzML', name: 'a.mzML', size: 1000, condition: 'ctrl', replicate: 1 },
    { path: '/data/b.mzML', name: 'b.mzML', size: 2000, condition: 'treated', replicate: 1, fraction: 2, techReplicate: 1 },
  ],
  database: { path: '/db/UP000005640_reviewed.fasta', name: 'UP000005640_reviewed.fasta', size: 9000, proteome: 'UP000005640' },
  contaminants: true,
  decoys: 'generate',
  presetId: 'orbitrap-hcd-tryptic',
  parameters: { 'precursor:mass_tolerance': 10, 'modifications:variable': ['Oxidation (M)'], decoys: 'generate' },
  rescore: true,
  peptdeep: false,
  threads: 8,
  sdrf: { path: '/data/exp.sdrf.tsv' },
  search: { id: '1730000000-1', name: 'exp' },
  ui: {
    view: 'results',
    showSettings: true,
    advanced: false,
    results: {
      tab: 'psms',
      showTechReplicates: false,
      panel: 3,
      panelTab: 'coverage',
      panelPeptide: null,
      psm: 7,
      levels: {
        proteins: { filters: { text: 'ALB', maxQ: 0.01, minPeptides: 2, minReplicatesInCondition: 0, hideContaminants: true, showDecoys: false }, sort: { key: 'psms', dir: 'desc' }, hidden: [], selected: 3 },
        peptides: { filters: { text: '', maxQ: NaN, minPeptides: 0, minReplicatesInCondition: 0, hideContaminants: true, showDecoys: false }, sort: { key: 'psms', dir: 'desc' }, hidden: ['length'], selected: null },
        psms: {
          filters: { text: '', maxQ: 0.01, minPeptides: 0, minReplicatesInCondition: 0, hideContaminants: true, showDecoys: true, charges: [2, 3], ranges: [{ key: 'rt', min: 100, max: Infinity }] },
          sort: { key: 'qValue', dir: 'asc' },
          hidden: [],
          selected: 7,
        },
      },
    },
  },
})

describe('project files', () => {
  test('a setup is written and read back as it was (NaN and infinite numbers as null in the file)', () => {
    const text = serializeSetup(setup())
    expect(text).not.toContain('NaN')
    expect(text).not.toContain('Infinity')
    const back = parseSetup(text)
    expect(back.ui.results!.levels.peptides.filters.maxQ).toBeNaN()
    expect(back.ui.results!.levels.psms.filters.ranges).toEqual([{ key: 'rt', min: 100, max: Infinity }])
    // everything else as it was
    const strip = (s: ProjectSetup) => JSON.parse(serializeSetup(s))
    expect(strip(back)).toEqual(strip(setup()))
    expect(back.inputs[1]).toEqual(setup().inputs[1])
    expect(back.sdrf).toEqual({ path: '/data/exp.sdrf.tsv' })
    expect(back.search).toEqual({ id: '1730000000-1', name: 'exp' })
  })

  test('the schema is checked: a newer one is refused, not guessed at; other files are no projects', () => {
    const newer = { ...setup(), schema: SETUP_SCHEMA + 1 }
    expect(() => parseSetup(JSON.stringify(newer))).toThrow(/saved by a newer ProSE \(project schema 2; this app reads up to 1, saved by app 0\.1\.4\)/)
    expect(() => parseSetup(JSON.stringify({ ...setup(), schema: 'one' }))).toThrow(/no valid schema version/)
    expect(() => parseSetup(JSON.stringify({ ...setup(), format: 'other' }))).toThrow(/not a ProSE project file/)
    expect(() => parseSetup('{ not json')).toThrow(SetupError)
    expect(() => parseSetup(JSON.stringify({ ...setup(), inputs: [{ name: 'a.mzML' }] }))).toThrow(/Input 1 of the project file has no path/)
    expect(() => parseSetup(JSON.stringify({ ...setup(), inputs: undefined }))).toThrow(/no list of inputs/)
  })

  test('fields left out take their defaults, and broken view state is dropped', () => {
    const back = parseSetup(JSON.stringify({ format: 'prose-setup', schema: 1, inputs: [{ path: '/x/run.mzML' }], ui: { view: 'nowhere', results: { tab: 'psms' } } }))
    expect(back.inputs).toEqual([{ path: '/x/run.mzML', name: 'run.mzML', size: 0 }])
    expect(back.database).toBeNull()
    expect(back.ui).toEqual({ view: 'search', showSettings: false, advanced: false, results: null })
    expect(back).toMatchObject({ contaminants: true, rescore: true, peptdeep: false, threads: null, sdrf: null, search: null, parameters: {} })
  })

  test('the files that are gone or changed size are named', () => {
    const s = setup()
    const expected = [...s.inputs, s.database!, { path: '/data/new.mzML', name: 'new.mzML', size: 0 }]
    const found = [
      { path: '/data/a.mzML', size: 1000, error: null },
      { path: '/data/b.mzML', size: 2500, error: null },
      { path: '/db/UP000005640_reviewed.fasta', size: 0, error: 'not found' },
      // (a size not known when saved is not compared)
      { path: '/data/new.mzML', size: 77, error: null },
    ]
    expect(checkFiles(expected, found)).toEqual({
      missing: ['UP000005640_reviewed.fasta'],
      changed: [{ name: 'b.mzML', was: 2000, now: 2500 }],
    })
    expect(checkFiles(s.inputs, [])).toEqual({ missing: ['a.mzML', 'b.mzML'], changed: [] })
  })

  test('names: the project from its file, the proteome from a downloaded FASTA', () => {
    expect(setupName('/a/b/exp 1.prose-setup.json')).toBe('exp 1')
    expect(setupName('C:\\data\\Exp.PROSE-SETUP.JSON')).toBe('Exp')
    expect(setupName('exp.json')).toBe('exp')
    expect(proteomeOf('UP000005640.fasta')).toBe('UP000005640')
    expect(proteomeOf('UP000005640_reviewed.fasta')).toBe('UP000005640')
    expect(proteomeOf('human.fasta')).toBeNull()
  })
})
