import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchProgress, SearchRequest } from '../desktop'

// The run of a search in the session, against a fake shim: its progress, the result read from its
// folder, a failure with ProSE's stage and file, and a cancel (also one that races the end).

const fake = vi.hoisted(() => ({
  start: vi.fn(),
  cancel: vi.fn(async () => {}),
  stop: vi.fn(),
  read: vi.fn(),
}))

vi.mock('../desktop', async () => {
  class SearchFailed extends Error {
    constructor(
      message: string,
      readonly stage: string,
      readonly file: number,
    ) {
      super(message)
    }
  }
  return {
    SearchFailed,
    startSearch: fake.start,
    cancelSearch: fake.cancel,
    searchFiles: (id: string) => `files of ${id}`,
    errorText: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  }
})
vi.mock('../results/read', () => ({ readSearch: fake.read }))

const { SearchFailed } = await import('../desktop')
const { cancelSearch, openResult, runSearch, searchProgress, searchRun } = await import('./session.svelte')

const request: SearchRequest = {
  files: [
    { id: 'f1', path: '/runs/a.mzML' },
    { id: 'f2', path: '/runs/b.mzML.gz' },
  ],
  database: '/db/human.fasta',
  contaminants: true,
  settings: { parameters: {}, rescore: true, peptdeep: false, threads: 0 },
}
const meta = {
  design: { rows: [], samples: [], conditions: [] } as never,
  psmFdr: 0.01,
  proteinFdr: 0.01,
  settings: { parameters: {}, fixedMods: [], database: 'human.fasta', rescore: true, peptdeep: false, contaminants: true },
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((r, j) => ((resolve = r), (reject = j)))
  return { promise, resolve, reject }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

/** A started search of the fake shim: its progress callback and how it ends. */
function started(id = '17-0') {
  const done = deferred<{ folder: string }>()
  let progress!: (p: SearchProgress) => void
  fake.start.mockImplementationOnce(async (_r: SearchRequest, onProgress: (p: SearchProgress) => void) => {
    progress = onProgress
    return { searchId: id, done: done.promise, stop: fake.stop }
  })
  return { done, progress: (p: SearchProgress) => progress(p) }
}

describe('runSearch', () => {
  beforeEach(() => {
    fake.start.mockReset()
    fake.cancel.mockClear()
    fake.read.mockReset()
    searchRun.status = 'idle'
  })

  it('follows the progress, then reads the folder and opens the result', async () => {
    const search = started()
    const result = { summary: {}, tables: {}, spectra: {}, predicted: {}, warnings: [] }
    fake.read.mockResolvedValue(result)
    const run = runSearch(request, meta)
    await settle()
    expect(searchRun.status).toBe('running')
    expect(searchRun.files).toEqual(['a.mzML', 'b.mzML.gz'])
    expect(searchProgress.label).toBe('Starting ProSE…')
    expect(searchProgress.threads).toBe('all threads')
    search.progress({ label: 'Searching b.mzML.gz (2 of 2)...', file: 1, fraction: 0.5 })
    expect(searchProgress.label).toBe('Searching b.mzML.gz (2 of 2)…')
    expect(searchProgress.percent).toBe(50)
    search.done.resolve({ folder: '/data/searches/17-0' })
    expect(await run).toBe('17-0')
    expect(fake.read).toHaveBeenCalledWith('files of 17-0')
    expect(searchRun.status).toBe('done')
    expect(openResult.current?.id).toBe('17-0')
    expect(openResult.current?.outcome.summary).toBe(result.summary)
    expect(openResult.current?.outcome.seconds).toBeGreaterThanOrEqual(0)
  })

  it('a failure says where: the stage and the file ProSE was at', async () => {
    const search = started()
    const run = runSearch(request, meta)
    await settle()
    search.done.reject(new SearchFailed('Error: Unable to read file (broken)', 'Searching b.mzML.gz (2 of 2)...', 1))
    expect(await run).toBeNull()
    expect(searchRun.status).toBe('failed')
    expect(searchRun.failure?.context).toBe('While searching file 2 of 2 (b.mzML.gz)')
    expect(searchRun.failure?.summary).toBe('Error: Unable to read file (broken)')
  })

  it('a request the shim refuses fails before the search', async () => {
    fake.start.mockRejectedValueOnce(new Error('The input file /runs/a.mzML cannot be read (No such file or directory).'))
    expect(await runSearch(request, meta)).toBeNull()
    expect(searchRun.failure).toEqual({
      context: 'Before the search',
      summary: 'The input file /runs/a.mzML cannot be read (No such file or directory).',
      detail: null,
    })
  })

  it('cancel ends the run at once and the search in the shim', async () => {
    started('18-0')
    const run = runSearch(request, meta)
    await settle()
    cancelSearch()
    expect(searchRun.status).toBe('cancelled')
    expect(fake.cancel).toHaveBeenCalledWith('18-0')
    // no longer listening to its events
    expect(fake.stop).toHaveBeenCalled()
    expect(await Promise.race([run, settle().then(() => 'pending')])).toBeNull()
  })

  it('a search that finishes as it is cancelled stays cancelled: its done is not opened', async () => {
    const before = openResult.current
    const search = started('19-0')
    const run = runSearch(request, meta)
    await settle()
    cancelSearch()
    // the shim's done of a search that ended just before the cancel reached it
    search.done.resolve({ folder: '/data/searches/19-0' })
    expect(await run).toBeNull()
    expect(fake.read).not.toHaveBeenCalled()
    expect(searchRun.status).toBe('cancelled')
    expect(openResult.current).toBe(before)
  })

  it('results that cannot be read fail the run, saying so', async () => {
    const search = started()
    fake.read.mockRejectedValue(new Error('qpx/1__a.psm.parquet: not a Parquet file'))
    const run = runSearch(request, meta)
    await settle()
    search.done.resolve({ folder: '/x' })
    expect(await run).toBeNull()
    expect(searchRun.failure).toEqual({ context: 'While reading the results', summary: 'qpx/1__a.psm.parquet: not a Parquet file', detail: null })
  })
})
