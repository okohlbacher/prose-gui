// A History backend in memory, for the tests: the folders of the searches as maps of file names to
// bytes, with the semantics of the Rust commands that the tests rely on (src-tauri/src/history.rs).

import type { HistoryBackend, HistoryEntry } from './history'

export class NotFound extends Error {
  readonly notFound = true
}

/** The entries of a `frameEntries` body (the layout of `history::frame`). */
export function unframe(body: Uint8Array): { name: string; data: Uint8Array }[] {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength)
  const out: { name: string; data: Uint8Array }[] = []
  let at = 0
  while (at < body.length) {
    const nameLength = view.getUint32(at)
    const name = new TextDecoder().decode(body.subarray(at + 4, at + 4 + nameLength))
    at += 4 + nameLength
    const length = Number(view.getBigUint64(at))
    out.push({ name, data: body.subarray(at + 8, at + 8 + length) })
    at += 8 + length
  }
  return out
}

export class MemoryBackend implements HistoryBackend {
  folders = new Map<string, Map<string, Uint8Array>>()
  /** The `.prose` files "on disk", by path, and the one the open dialog gives. */
  projects = new Map<string, Uint8Array>()
  chosen: string | null = null
  /** What the save dialog got, and whether the user cancels it. */
  saved: { name: string; bytes: Uint8Array }[] = []
  cancelSave = false
  imported = 0
  failures: Partial<Record<'list' | 'save' | 'rename' | 'delete', string>> = {}

  /** A folder as the shim leaves it. */
  addFolder(id: string, files: Record<string, Uint8Array | string>): void {
    this.folders.set(
      id,
      new Map(Object.entries(files).map(([name, data]) => [name, typeof data === 'string' ? new TextEncoder().encode(data) : data])),
    )
  }

  private folder(id: string): Map<string, Uint8Array> {
    const folder = this.folders.get(id)
    if (!folder) throw new Error(`The search ${id} does not exist.`)
    return folder
  }

  async list(): Promise<HistoryEntry[]> {
    if (this.failures.list) throw new Error(this.failures.list)
    const entries: HistoryEntry[] = []
    for (const [id, folder] of this.folders) {
      const record = folder.get('search.json')
      if (!record) continue
      const bytes = [...folder.values()].reduce((n, f) => n + f.length, 0)
      const entry: HistoryEntry = { id, name: null, createdAt: null, appVersion: null, toolVersion: null, files: [], database: null, psms: null, bytes, error: null }
      try {
        const json = JSON.parse(new TextDecoder().decode(record))
        if (typeof json?.schema !== 'number') throw new Error('search.json has no schema: it is not a ProSE search record.')
        if (json.schema > 1) throw new Error(`This search was saved by a newer version of ProSE (schema ${json.schema}).`)
        Object.assign(entry, {
          name: json.name ?? null,
          createdAt: json.createdAt ?? null,
          appVersion: json.appVersion ?? null,
          toolVersion: json.toolVersion ?? null,
          files: json.files ?? [],
          database: json.database ?? null,
          psms: json.psms ?? null,
        })
      } catch (e) {
        entry.error = (e as Error).message.startsWith('search.json') || (e as Error).message.startsWith('This') ? (e as Error).message : 'search.json is not valid JSON.'
      }
      entries.push(entry)
    }
    return entries.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  }

  async read(id: string, name: string): Promise<Uint8Array> {
    const data = this.folder(id).get(name)
    if (!data) throw new NotFound(`${name} does not exist.`)
    return data
  }

  async save(id: string, record: string, proteins: string): Promise<void> {
    if (this.failures.save) throw new Error(this.failures.save)
    const folder = this.folder(id)
    if (folder.has('search.json')) throw new Error(`The search ${id} is already saved.`)
    folder.set('proteins.fasta', new TextEncoder().encode(proteins))
    folder.set('search.json', new TextEncoder().encode(record))
  }

  async rename(id: string, name: string): Promise<void> {
    if (this.failures.rename) throw new Error(this.failures.rename)
    const folder = this.folder(id)
    const json = JSON.parse(new TextDecoder().decode(folder.get('search.json')))
    json.name = name.trim()
    folder.set('search.json', new TextEncoder().encode(JSON.stringify(json)))
  }

  async delete(id: string): Promise<void> {
    if (this.failures.delete) throw new Error(this.failures.delete)
    this.folders.delete(id)
  }

  async files(id: string): Promise<{ name: string; size: number }[]> {
    return [...this.folder(id)].map(([name, data]) => ({ name, size: data.length }))
  }

  async saveProject(name: string, bytes: Uint8Array): Promise<string | null> {
    if (this.cancelSave) return null
    this.saved.push({ name, bytes })
    return `/saved/${name}`
  }

  async chooseProject(): Promise<string | null> {
    return this.chosen
  }

  async readProject(path: string): Promise<Uint8Array> {
    const bytes = this.projects.get(path)
    if (!bytes) throw new Error(`${path} cannot be read.`)
    return bytes
  }

  async importEntries(body: Uint8Array): Promise<string> {
    const id = `${1000 + ++this.imported}-i0`
    const files = new Map(unframe(body).map((e) => [e.name, e.data]))
    const record = files.get('search.json')
    if (!record) throw new Error('The project has no search.json.')
    const json = JSON.parse(new TextDecoder().decode(record))
    json.id = id
    files.set('search.json', new TextEncoder().encode(JSON.stringify(json)))
    this.folders.set(id, files)
    return id
  }
}
