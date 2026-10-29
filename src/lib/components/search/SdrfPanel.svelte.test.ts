// @vitest-environment happy-dom
// The SDRF in New search, as a user goes through it (the shim's commands replaced): an SDRF is loaded and its
// files resolved, the panel says what is missing, the search waits until it is searched without it; the metadata
// editor changes a factor value and the design table follows; "Download missing…" fetches from PRIDE.
import { readFileSync } from 'node:fs'
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileFacts } from '$lib/desktop'

const facts = (path: string): FileFacts => ({
  path,
  name: path.split('/').pop()!,
  size: 1000,
  spectra: 139,
  proteins: null,
  residues: null,
  error: null,
  problem: null,
  warnings: [],
  instrument: { name: 'LTQ Orbitrap XL', accession: 'MS:1000556' },
})

const shim = vi.hoisted(() => ({
  located: [] as { exact: string | null; mzml: string | null }[],
  /** Replaces `located` when set: the look-up's answer for these names. */
  locate: null as null | ((names: string[]) => Promise<{ exact: string | null; mzml: string | null }[]>),
  asked: [] as string[][],
  chosen: null as string | null,
  downloads: [] as { files: { name: string; url: string }[]; folder: string }[],
}))
vi.mock('$lib/desktop', () => ({
  inspectFiles: vi.fn(async (paths: string[]) => paths.map(facts)),
  locateDataFiles: vi.fn(async (_sdrf: string, names: string[]) => {
    shim.asked.push(names)
    return shim.locate ? shim.locate(names) : shim.located
  }),
  chooseFolder: vi.fn(async () => '/downloads'),
  chooseDownloadFolder: vi.fn(async () => '/downloads'),
  chooseFile: vi.fn(async () => shim.chosen),
  prideFiles: vi.fn(async () => [{ name: 'Ecoli_3.mzML', size: 10, url: 'https://ftp.pride.ebi.ac.uk/x/Ecoli_3.mzML' }]),
  downloadDataFiles: vi.fn(async (files: { name: string; url: string }[]) => {
    const folder = '/downloads'
    shim.downloads.push({ files, folder })
    shim.located = [
      { exact: '/sdrf/Ecoli_1.mzML', mzml: '/sdrf/Ecoli_1.mzML' },
      { exact: null, mzml: '/sdrf/Ecoli_2.mzML' },
      { exact: '/downloads/Ecoli_3.mzML', mzml: '/downloads/Ecoli_3.mzML' },
    ]
    return files.map((f) => `${folder}/${f.name}`)
  }),
  cancelDownload: vi.fn(async () => {}),
  openDesignFile: vi.fn(async () => null),
  olsSearch: vi.fn(async () => []),
  validateSdrf: vi.fn(async () => ({ available: false, ok: false, output: '' })),
  isDesktop: () => true,
  errorText: (e: unknown) => String(e),
}))

const { searchForm: form } = await import('$lib/search/form.svelte')
const { sdrfSession: sdrf } = await import('$lib/design/sdrf-session.svelte')
const { column } = await import('$lib/design/sdrf-table')
const SdrfPanel = (await import('./SdrfPanel.svelte')).default
const SdrfEditor = (await import('./SdrfEditor.svelte')).default

// (from the root of the project: under happy-dom, import.meta.url is not a file URL)
const ecoli = readFileSync('src/lib/design/sdrf-fixtures/ecoli.sdrf.tsv', 'utf8')
let shown: Record<string, unknown>[] = []

beforeEach(async () => {
  form.files = []
  form.notices = []
  sdrf.clear()
  shim.located = [
    { exact: '/sdrf/Ecoli_1.mzML', mzml: '/sdrf/Ecoli_1.mzML' },
    { exact: null, mzml: '/sdrf/Ecoli_2.mzML' },
    { exact: null, mzml: null },
  ]
  shim.downloads = []
  shim.locate = null
  shim.asked = []
  shim.chosen = null
  await sdrf.load('/sdrf/PXD000001_ecoli.sdrf.tsv', ecoli)
})
afterEach(() => {
  for (const s of shown) unmount(s)
  shown = []
  document.body.innerHTML = ''
})

const text = () => document.body.textContent ?? ''

describe('an SDRF in New search', () => {
  it('adds the files found, with their design and instrument, and says what is missing', async () => {
    expect(form.files.map((r) => [r.file.name, r.condition, r.replicate, r.instrument])).toEqual([
      ['Ecoli_1.mzML', 'wild type', 1, 'NT=LTQ Orbitrap XL;AC=MS:1000556'],
      ['Ecoli_2.mzML', 'wild type', 2, 'NT=LTQ Orbitrap XL;AC=MS:1000556'],
    ])
    expect(sdrf.files.map((f) => f.status)).toEqual(['found', 'mzml', 'missing'])
    expect(sdrf.problem).toContain('Ecoli_3.mzML')
    shown.push(mount(SdrfPanel, { target: document.body }))
    flushSync()
    expect(text()).toContain('2 of 3 data files found')
    expect(text()).toContain('Ecoli_3.mzML')
    // the accession from the SDRF's file name, for the download
    expect((document.querySelector('#sdrf-pxd') as HTMLInputElement).value).toBe('PXD000001')
    const skip = document.querySelector<HTMLInputElement>('[data-testid="sdrf-panel"] input[type="checkbox"]')!
    skip.click()
    flushSync()
    expect(sdrf.problem).toBeNull()
  })

  it('downloads the missing file from PRIDE and finds it afterwards', async () => {
    await sdrf.downloadMissing()
    expect(shim.downloads).toEqual([
      { files: [{ name: 'Ecoli_3.mzML', size: 10, url: 'https://ftp.pride.ebi.ac.uk/x/Ecoli_3.mzML' }], folder: '/downloads' },
    ])
    expect(sdrf.unresolved).toEqual([])
    expect(form.files.map((r) => r.file.path)).toContain('/downloads/Ecoli_3.mzML')
    expect(sdrf.problem).toBeNull()
  })

  it('the metadata editor shows every column, and a factor value changed there changes the design table', async () => {
    shown.push(mount(SdrfEditor, { target: document.body, props: { open: true } }))
    flushSync()
    await tick()
    const t = sdrf.table!
    const factor = column(t, 'factor value[condition]')
    const inputs = [...document.querySelectorAll<HTMLInputElement>('[data-testid="sdrf-editor"] input[aria-label^="factor value[condition]"]')]
    expect(inputs.map((i) => i.value)).toEqual(['wild type', 'wild type', 'wild type'])
    expect(document.querySelectorAll('[data-testid="sdrf-editor"] thead th').length).toBe(t.headers.length + 1)
    inputs[1].value = 'knockout'
    inputs[1].dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    expect(sdrf.table!.rows[1][factor]).toBe('knockout')
    expect(form.files.find((r) => r.file.name === 'Ecoli_2.mzML')!.condition).toBe('knockout')
    // and back: the design table's edit is in the SDRF the editor opens on
    form.setField(form.files[0].id, 'replicate', 7)
    sdrf.commitDesign()
    expect(sdrf.table!.rows[0][column(sdrf.table!, 'characteristics[biological replicate]')]).toBe('7')
  })

  it('a look-up of an earlier SDRF changes nothing of the one loaded since', async () => {
    form.files = []
    let answerA!: (v: { exact: string | null; mzml: string | null }[]) => void
    shim.locate = () => new Promise((resolve) => (answerA = resolve))
    const a = sdrf.load('/a/A.sdrf.tsv', ecoli)
    shim.locate = async (names) => names.map(() => ({ exact: null, mzml: null }))
    await sdrf.load('/b/B.sdrf.tsv', ecoli.replace(/Ecoli_/g, 'Other_'))
    answerA([
      { exact: '/a/Ecoli_1.mzML', mzml: null },
      { exact: '/a/Ecoli_2.raw', mzml: null },
      { exact: null, mzml: null },
    ])
    await a
    expect(sdrf.name).toBe('B.sdrf.tsv')
    expect(sdrf.files.map((f) => [f.name, f.path])).toEqual([
      ['Other_1.mzML', null],
      ['Other_2.raw', null],
      ['Other_3.mzML', null],
    ])
    expect(form.files).toEqual([])
  })

  it('gives its design to files that were in the table before it was loaded', async () => {
    sdrf.clear()
    form.files = []
    await form.addFiles(['/sdrf/Ecoli_1.mzML'])
    expect(form.files[0].condition).toBeUndefined()
    await sdrf.load('/sdrf/ecoli.sdrf.tsv', ecoli)
    expect(form.files.map((r) => [r.file.name, r.condition, r.replicate])).toEqual([
      ['Ecoli_1.mzML', 'wild type', 1],
      ['Ecoli_2.mzML', 'wild type', 2],
    ])
    // a later look-up (Locate folder…) leaves what the user changed since
    form.setField(form.files[0].id, 'condition', 'changed')
    await sdrf.load('/sdrf/ecoli.sdrf.tsv', ecoli)
    expect(form.files[0].condition).toBe('wild type') // (a new load is a new SDRF: its design again)
  })

  it('looks a data file renamed in the editor up under its new name', async () => {
    const col = column(sdrf.table!, 'comment[data file]')
    shim.asked = []
    sdrf.update((t) => (t.rows[2][col] = 'Ecoli_4.mzML'))
    await tick()
    expect(sdrf.files.map((f) => f.name)).toEqual(['Ecoli_1.mzML', 'Ecoli_2.raw', 'Ecoli_4.mzML'])
    expect(sdrf.files.slice(0, 2).map((f) => f.status)).toEqual(['found', 'mzml'])
    expect(shim.asked).toEqual([['Ecoli_1.mzML', 'Ecoli_2.raw', 'Ecoli_4.mzML']])
  })

  it('Locate… of a Bruker .d takes the folder of the analysis.tdf chosen', async () => {
    shim.chosen = '/data/run3.d/analysis.tdf'
    await sdrf.locateFile('Ecoli_3.mzML')
    expect(sdrf.files[2].path).toBe('/data/run3.d')
  })
})
