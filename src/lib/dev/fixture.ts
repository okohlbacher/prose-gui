// Dev only (`vite dev`, the browser UI tests in e2e-web/): `?fixture=<name>` opens a bundled result of the
// reader's fixtures (src/lib/results/fixtures/<name>) in Results, through an in-memory History, as if the
// search had just been saved. main.ts imports this module only under import.meta.env.DEV with the flag, so
// it is not in the production bundle.

import { resolveDesign } from '../design/model'
import { folderFiles } from '../history/history'
import { openFromHistory, saveFinished, useBackend } from '../history/history.svelte'
import { MemoryBackend } from '../history/memory-backend'
import { readSearch } from '../results/read'
import { qpxParameters } from '../results/summary'
import type { OpenResult } from '../search/session.svelte'

/** The fixture files by path relative to this module (listed only; fetched raw from the dev server). */
const files = import.meta.glob('../results/fixtures/*/**/*', { query: '?url', import: 'default' })

/** Uses an in-memory History (before the app reads it). */
export function useMemoryHistory(): MemoryBackend {
  const backend = new MemoryBackend()
  useBackend(backend)
  return backend
}

/** Adds fixture `name` to `backend` as search `id`, saves it to History and opens it in Results. */
export async function openFixture(backend: MemoryBackend, name: string, id = '100-0'): Promise<void> {
  const prefix = `../results/fixtures/${name}/`
  const paths = Object.keys(files).filter((p) => p.startsWith(prefix))
  if (paths.length === 0) throw new Error(`No fixture ${name}.`)
  const folder: Record<string, Uint8Array> = {}
  await Promise.all(
    paths.map(async (p) => {
      const response = await fetch(new URL(p, import.meta.url))
      folder[p.slice(prefix.length)] = new Uint8Array(await response.arrayBuffer())
    }),
  )
  backend.addFolder(id, folder)
  const read = await readSearch(folderFiles(backend, id))
  const inputs = JSON.parse(new TextDecoder().decode(folder['inputs.json'])) as { id: string; name: string }[]
  const result: OpenResult = {
    id,
    createdAt: '2026-10-20T10:00:00.000Z',
    outcome: { ...read, seconds: 12.5 },
    design: resolveDesign(inputs.map((f, i) => ({ id: f.id, fileName: f.name, fileSize: 1000, condition: i % 2 ? 'b' : 'a' }))),
    psmFdr: 0.02,
    proteinFdr: 0.01,
    settings: {
      // what ProSE recorded, so that the checks of the search find no setting it did not use
      parameters: read.provenance ? qpxParameters(new Map(Object.entries(read.provenance))) : {},
      fixedMods: ['Carbamidomethyl (C)'],
      database: 'ecoli.fasta',
      rescore: true,
      peptdeep: false,
      contaminants: true,
      presetId: 'example',
    },
  }
  await saveFinished(result)
  await openFromHistory(id)
}
