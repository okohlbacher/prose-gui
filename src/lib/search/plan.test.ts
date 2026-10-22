import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { FileFacts, SearchRequest } from '../desktop'

// What the New search form amounts to and what startSearch() sends to the shim (the shim's commands,
// the session and the router are replaced): the request, the footer line, the problems.

const sent: SearchRequest[] = []
vi.mock('./session.svelte', () => ({
  searchRun: { status: 'idle' },
  runSearch: vi.fn(async (request: SearchRequest) => {
    sent.push(request)
    return null
  }),
}))
vi.mock('../route.svelte', () => ({ navigate: vi.fn() }))

/** The shim's file facts: an mzML of 139 spectra, a FASTA of 4,136 proteins, by name. */
const facts = (path: string): FileFacts => {
  const name = path.split('/').pop()!
  const fasta = name.endsWith('.fasta')
  return {
    path,
    name,
    size: fasta ? 1686907 : 1152596,
    spectra: fasta ? null : 139,
    proteins: fasta ? 4136 : null,
    residues: fasta ? 1306000 : null,
    error: null,
  }
}
vi.mock('../desktop', () => ({
  inspectFiles: vi.fn(async (paths: string[]) => paths.map(facts)),
  exampleFiles: vi.fn(async () => ({
    spectra: ['/data/example/Ecoli_1.mzML', '/data/example/Ecoli_2.mzML'],
    database: '/app/resources/example/Ecoli_K12_proteome.fasta',
  })),
  errorText: (e: unknown) => String(e),
}))

const { searchForm: form } = await import('./form.svelte')
const { searchPlan, searchRequest, startSearch } = await import('./plan.svelte')
const { toolState } = await import('./tool.svelte')

/** The names the shim lets through (src-tauri/src/args.rs `PARAMETERS`). */
const allowlist = new Set(
  [
    ...(/pub const PARAMETERS: &\[\(&str, Kind\)\] = &\[([\s\S]*?)\];/.exec(
      readFileSync(new URL('../../../src-tauri/src/args.rs', import.meta.url), 'utf8'),
    )?.[1] ?? '').matchAll(/\("([^"]+)",\s*\w+\)/g),
  ].map((m) => m[1]),
)

const settle = () => new Promise((r) => setTimeout(r, 0))

async function request(): Promise<SearchRequest> {
  sent.length = 0
  await startSearch()
  expect(sent).toHaveLength(1)
  return sent[0]
}

describe('the search request', () => {
  beforeEach(async () => {
    form.files = []
    form.database = null
    form.notices = []
    form.choosePreset('orbitrap-hcd-tryptic')
    form.contaminants = true
    form.rescore = true
    form.peptdeep = false
    form.threads = null
    Object.assign(toolState, { status: 'ready', info: { version: '3.7.0', path: '/x/ProSE', onnx: true }, error: null })
  })

  test('the form builds the arguments of the example preset', async () => {
    await form.loadExample()
    await settle()
    expect(form.isExample).toBe(true)
    const r = await request()
    // the Orbitrap HCD preset, on ProSE's defaults: what differs is sent, by the shim's names
    expect(r.settings.parameters).toEqual({
      enzyme: 'Trypsin/P',
      'modifications:variable': ['Oxidation (M)', 'Acetyl (Protein N-term)'],
      'FDR:PSM': 0.01,
      'FDR:protein': 0.01,
      'peptide:missed_cleavages': 2,
      // the example's ion-trap fragments
      'fragment:mass_tolerance': 0.5,
      'fragment:mass_tolerance_unit': 'Da',
    })
    for (const name of Object.keys(r.settings.parameters)) expect(allowlist.has(name), name).toBe(true)
    expect(r.settings).toMatchObject({ rescore: true, peptdeep: false, threads: 0 })
    expect(r.contaminants).toBe(true)
    expect(searchPlan.line).toBe(
      "2 files in 2 samples · 4,136 proteins + 116 cRAP + decoys · ion-trap example, 0.5 Da fragment tolerance · too few PSMs for Percolator's full model or a protein FDR",
    )
  })

  test('a search request carries paths, not file contents', async () => {
    await form.addFiles(['/runs/a/sample.mzML', '/runs/b/sample.mzML.gz', '/db/human.fasta'])
    await settle()
    const r = await request()
    expect(r.files).toEqual([
      { id: form.files[0].id, path: '/runs/a/sample.mzML' },
      { id: form.files[1].id, path: '/runs/b/sample.mzML.gz' },
    ])
    expect(r.database).toBe('/db/human.fasta')
    // plain JSON: strings, numbers, booleans, lists (no File, Blob or bytes)
    const json = JSON.stringify(r)
    expect(JSON.parse(json)).toEqual(r)
    const leaves = (v: unknown): unknown[] => (v !== null && typeof v === 'object' ? Object.values(v).flatMap(leaves) : [v])
    for (const leaf of leaves(r)) expect(['string', 'number', 'boolean']).toContain(typeof leaf)
  })

  test('every preset sends only names the shim lets through', async () => {
    await form.addFiles(['/r/run.mzML', '/db/db.fasta'])
    await settle()
    for (const preset of form.presets) {
      form.choosePreset(preset.id)
      const r = searchRequest()!
      for (const name of Object.keys(r.settings.parameters)) expect(allowlist.has(name), `${preset.id}: ${name}`).toBe(true)
    }
  })

  test('Advanced: the threads (all cores by default) and the database chunks', async () => {
    await form.addFiles(['/r/run.mzML', '/db/db.fasta'])
    await settle()
    expect(searchRequest()!.settings.threads).toBe(0)
    form.threads = 4
    form.setParam('database:chunk_size', 2000)
    const r = searchRequest()!
    expect(r.settings.threads).toBe(4)
    expect(r.settings.parameters['database:chunk_size']).toBe(2000)
    expect('threads' in r.settings.parameters).toBe(false)
  })

  test('PeptDeep needs Percolator and a ProSE with ONNX Runtime', async () => {
    await form.addFiles(['/r/run.mzML', '/db/db.fasta'])
    await settle()
    form.peptdeep = true
    expect(searchRequest()!.settings.peptdeep).toBe(true)
    form.rescore = false
    expect(searchRequest()!.settings).toMatchObject({ peptdeep: false, rescore: false })
    form.rescore = true
    Object.assign(toolState, { info: { version: '3.7.0', path: '/x/ProSE', onnx: false } })
    expect(searchRequest()!.settings.peptdeep).toBe(false)
  })
})

describe('the footer', () => {
  beforeEach(() => {
    form.files = []
    form.database = null
    form.notices = []
    form.choosePreset('orbitrap-hcd-tryptic')
    Object.assign(toolState, { status: 'ready', info: { version: '3.7.0', path: '/x/ProSE', onnx: true }, error: null })
  })

  test('says what is missing, and why the search cannot start', async () => {
    expect(searchPlan.line).toBe('No spectra yet')
    expect(searchPlan.problem).toBe('Add mzML files to start.')
    await form.addFiles(['/r/run.mzML'])
    expect(searchPlan.line).toBe('1 file · no database yet')
    expect(searchPlan.problem).toBe('Choose a FASTA database to start.')
    await form.addFiles(['/db/db.fasta'])
    await settle()
    expect(searchPlan.line).toBe('1 file · 4,136 proteins + 116 cRAP + decoys')
    expect(searchPlan.canStart).toBe(true)
    form.setParam('modifications:variable', ['Oxidation (M)', 'Nonsense (Q)'])
    expect(searchPlan.problem).toMatch(/^Unknown modification: Nonsense \(Q\)\. ProSE does not know this name/)
    form.setParam('modifications:variable', ['Phospho (S)'])
    expect(searchPlan.problem).toBeNull()
    Object.assign(toolState, { status: 'failed', info: null, error: 'PROSE_BIN is set to /x, which is not a file.' })
    expect(searchPlan.problem).toBe('ProSE cannot be run: PROSE_BIN is set to /x, which is not a file.')
  })

  test('Remove all and Start over: no files (Start over: no database either), the settings as they were', async () => {
    await form.addFiles(['/r/a.mzML', '/r/b.mzML', '/db/db.fasta'])
    await settle()
    form.choosePreset('open-search')
    form.setParam('fragment:mass_tolerance', 0.5)
    form.peptdeep = true
    form.notices.push('a notice about the files')
    form.removeAllFiles()
    expect(form.files).toEqual([])
    expect(form.notices).toEqual([])
    expect(form.database?.file.name).toBe('db.fasta')
    await form.addFiles(['/r/a.mzML'])
    form.startOver()
    expect(form.files).toEqual([])
    expect(form.database).toBeNull()
    expect(searchPlan.line).toBe('No spectra yet')
    expect(form.presetId).toBe('open-search')
    expect(form.value('fragment:mass_tolerance')).toBe(0.5)
    expect(form.peptdeep).toBe(true)
    form.peptdeep = false
  })

  test("the example's fragment tolerance goes back to the preset's when its files go, and its protein FDR is the preset's", async () => {
    form.setParam('FDR:protein', 0.05)
    await form.loadExample()
    await settle()
    expect(form.value('FDR:protein')).toBe(0.01)
    expect([form.value('fragment:mass_tolerance'), form.value('fragment:mass_tolerance_unit')]).toEqual([0.5, 'Da'])
    // Start over: the preset's 20 ppm again (the other settings stay)
    form.peptdeep = true
    form.startOver()
    expect([form.value('fragment:mass_tolerance'), form.value('fragment:mass_tolerance_unit')]).toEqual([20, 'ppm'])
    expect(form.peptdeep).toBe(true)
    form.peptdeep = false
    // Undo brings back the files, the database and the example's tolerance
    expect(form.removed?.files).toHaveLength(2)
    form.undoRemove()
    await settle()
    expect(form.isExample).toBe(true)
    expect(form.value('fragment:mass_tolerance')).toBe(0.5)
    expect(form.removed).toBeNull()
    // own files added to the example's: the example's settings end
    await form.addFiles(['/runs/mine.mzML'])
    expect([form.value('fragment:mass_tolerance'), form.value('fragment:mass_tolerance_unit')]).toEqual([20, 'ppm'])
    // a tolerance the user set after loading the example stays
    await form.loadExample()
    await settle()
    form.setParam('fragment:mass_tolerance', 0.3)
    form.removeAllFiles()
    expect([form.value('fragment:mass_tolerance'), form.value('fragment:mass_tolerance_unit')]).toEqual([0.3, 'Da'])
    // another database ends them too
    await form.loadExample()
    await settle()
    await form.setDatabase('/db/human.fasta')
    expect(form.value('fragment:mass_tolerance')).toBe(20)
  })

  test('Remove all and Start over wait while files or the example are loading', async () => {
    await form.addFiles(['/r/a.mzML', '/db/db.fasta'])
    await settle()
    const loading = form.loadExample()
    expect(form.busy).toBe(true)
    form.startOver()
    form.removeAllFiles()
    await loading
    await settle()
    expect(form.isExample).toBe(true)
    expect(form.removed).toBeNull()
  })

  test('files that are neither mzML nor FASTA are reported, not added', async () => {
    await form.addFiles(['/r/run.raw', '/r/run.mzML'])
    expect(form.files.map((r) => r.file.name)).toEqual(['run.mzML'])
    expect(form.notices[0]).toMatch(/^Not an mzML file: run\.raw\./)
  })
})
