/// <reference types="node" />
// Test support: the example search folder of the pinned tool (results/fixtures/example) and the result
// the session would hold for it. Not part of the app.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { input } from '../design/fixtures'
import { resolveDesign } from '../design/model'
import { readSearch } from '../results/read'
import type { OpenResult } from '../search/session.svelte'
import { folderFiles } from './history'
import { MemoryBackend } from './memory-backend'

const example = new URL('../results/fixtures/example/', import.meta.url).pathname

/** The files of a directory by relative name. */
export function readDir(dir: string, prefix = ''): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {}
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) Object.assign(out, readDir(path, `${prefix}${name}/`))
    else out[`${prefix}${name}`] = new Uint8Array(readFileSync(path))
  }
  return out
}

/** The example search folder as the shim leaves it. */
export const exampleFolder = (): Record<string, Uint8Array> => readDir(example)

/** The example as the session holds it after the search `id`. */
export async function exampleResult(folder: Record<string, Uint8Array>, id = '100-0'): Promise<OpenResult> {
  const backend = new MemoryBackend()
  backend.addFolder(id, folder)
  const read = await readSearch(folderFiles(backend, id))
  return {
    id,
    createdAt: '2026-10-20T10:00:00.000Z',
    outcome: { ...read, seconds: 12.5 },
    design: resolveDesign([input('DatabaseSuitability_1.mzML', { condition: 'a' }), input('DatabaseSuitability_2.mzML', { condition: 'b' })]),
    psmFdr: 0.01,
    proteinFdr: 0.05,
    settings: {
      parameters: { precursor_tolerance: 10 },
      fixedMods: ['Carbamidomethyl (C)'],
      database: 'human.fasta',
      rescore: true,
      peptdeep: false,
      contaminants: true,
      presetId: 'example',
    },
  }
}
