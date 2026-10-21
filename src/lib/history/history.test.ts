// History without the disk: the record, the folder a saved search leaves, the project file (made and
// read with fflate), and how a project is refused. Against a search folder of the pinned tool
// (results/fixtures/example) held in memory; the Rust side has its own tests (src-tauri/tests/history.rs).

import { strToU8, zipSync } from 'fflate'
import { beforeAll, describe, expect, test } from 'vitest'
import type { OpenResult } from '../search/session.svelte'
import {
  countPsms,
  exportProject,
  frameEntries,
  importProject,
  importProjectBytes,
  isPlainName,
  openSearch,
  parseRecord,
  ProjectError,
  ProjectVersionError,
  proteinsFasta,
  projectFileName,
  recordOf,
  saveSearch,
  unpackProject,
} from './history'
import { exampleFolder, exampleResult } from './fixtures'
import { MemoryBackend, unframe } from './memory-backend'

let fixture: Record<string, Uint8Array>
let result: OpenResult

beforeAll(async () => {
  fixture = exampleFolder()
  result = await exampleResult(fixture)
}, 60000)

/** A backend with the example searched as `id` and saved to History. */
async function savedBackend(id = '100-0', name = 'Example') {
  const backend = new MemoryBackend()
  backend.addFolder(id, fixture)
  await saveSearch(backend, { ...result, id }, name, '3.6.0')
  return backend
}

describe('the record', () => {
  test('search.json holds the fields of schema 1', () => {
    const record = recordOf(result, 'Example', '3.6.0')
    expect(Object.keys(record).sort()).toEqual(
      ['appVersion', 'createdAt', 'database', 'design', 'files', 'id', 'name', 'proteinFdr', 'psmFdr', 'psms', 'schema', 'seconds', 'settings', 'toolVersion'],
    )
    expect(record).toMatchObject({
      schema: 1,
      id: '100-0',
      name: 'Example',
      createdAt: '2026-10-20T10:00:00.000Z',
      toolVersion: '3.6.0',
      files: ['DatabaseSuitability_1.mzML', 'DatabaseSuitability_2.mzML'],
      database: 'human.fasta',
      psms: countPsms(result.outcome.tables, 0.01),
      seconds: 12.5,
    })
    expect(record.psms).toBeGreaterThan(0)
    expect(record.appVersion).toMatch(/^\d+\.\d+\.\d+/)
    // a stored result keeps the versions that made it
    const stored = recordOf({ ...result, stored: { name: 'x', appVersion: '0.0.9', moduleVersion: '3.5.0' } }, 'y', '3.6.0')
    expect([stored.appVersion, stored.toolVersion]).toEqual(['0.0.9', '3.5.0'])
    expect(parseRecord(JSON.stringify(record))).toEqual(JSON.parse(JSON.stringify(record)))
  })

  test('a record that is incomplete or of another kind is refused with a message', () => {
    const good = JSON.parse(JSON.stringify(recordOf(result, 'x', '1')))
    const refuse = (change: (r: Record<string, unknown>) => void, message: RegExp) => {
      const r = JSON.parse(JSON.stringify(good))
      change(r)
      expect(() => parseRecord(JSON.stringify(r))).toThrow(message)
    }
    expect(() => parseRecord('{ not json')).toThrow(/not valid JSON/)
    expect(() => parseRecord('[1]')).toThrow(/not a search record/)
    refuse((r) => delete r.schema, /no schema/)
    refuse((r) => (r.schema = 0), /unknown schema 0/)
    refuse((r) => delete r.design, /design is missing/)
    refuse((r) => delete r.settings, /settings is missing/)
    refuse((r) => (r.psmFdr = 'x'), /psmFdr is missing/)
    refuse((r) => delete r.name, /name is missing/)
  })

  test('a newer schema is refused with a message', () => {
    const newer = JSON.stringify({ ...recordOf(result, 'x', '1'), schema: 2 })
    expect(() => parseRecord(newer)).toThrow(ProjectVersionError)
    expect(() => parseRecord(newer)).toThrow(/saved by a newer version of ProSE \(schema 2\).*reads schema 1/)
    expect(() => parseRecord(newer, 'project')).toThrow(/This project was saved by a newer version/)
    expect(() => parseRecord(newer)).toThrow(/This search was saved by a newer version/)
  })
})

describe('proteins.fasta', () => {
  test('lists every protein of the table, decoys as searched', () => {
    const { proteins } = result.outcome.tables
    const fasta = proteinsFasta(result.outcome.tables)
    const lines = fasta.trimEnd().split('\n')
    expect(lines.length).toBe(2 * proteins.count)
    expect(proteins.count).toBeGreaterThan(10)
    for (let p = 0; p < proteins.count; p++) {
      const head = proteins.description[p] ? `${proteins.accession[p]} ${proteins.description[p]}` : proteins.accession[p]
      expect(lines[2 * p]).toBe(`>${head}`)
      expect(lines[2 * p + 1]).toBe(proteins.sequence[p])
    }
    // decoys are in it, with their generated sequences
    const decoy = [...proteins.decoy].findIndex((d) => d === 1)
    expect(decoy).toBeGreaterThanOrEqual(0)
    expect(proteins.sequence[decoy].length).toBeGreaterThan(0)
    expect(fasta).toContain(`>${proteins.accession[decoy]}`)
  })

  test('is one entry per protein even with line ends in a description', () => {
    const tables = structuredClone(result.outcome.tables)
    tables.proteins.description[0] = 'a\nb\r\nc'
    const lines = proteinsFasta(tables).trimEnd().split('\n')
    expect(lines.length).toBe(2 * tables.proteins.count)
    expect(lines[0]).toBe(`>${tables.proteins.accession[0]} a b c`)
  })

  test('is empty without proteins', () => {
    const tables = structuredClone(result.outcome.tables)
    tables.proteins.count = 0
    expect(proteinsFasta(tables)).toBe('')
  })
})

describe('a saved search', () => {
  test('is a folder with proteins.fasta and search.json that opens again', async () => {
    const backend = await savedBackend()
    const folder = backend.folders.get('100-0')!
    expect(folder.has('search.json') && folder.has('proteins.fasta')).toBe(true)
    const opened = await openSearch(backend, '100-0')
    expect(opened.origin).toEqual({ id: '100-0', createdAt: '2026-10-20T10:00:00.000Z' })
    expect(opened.result.outcome.tables).toEqual(result.outcome.tables)
    expect(opened.result.outcome.seconds).toBe(12.5)
    expect(opened.result.stored).toEqual({ name: 'Example', appVersion: recordOf(result, '', '').appVersion, moduleVersion: '3.6.0' })
    expect(opened.result.settings).toEqual(result.settings)
    expect(opened.result.design).toEqual(JSON.parse(JSON.stringify(result.design)))
    expect([opened.result.psmFdr, opened.result.proteinFdr]).toEqual([0.01, 0.05])
  })

  test('opens when the FASTA it was searched with is gone: proteins.fasta has the sequences', async () => {
    const backend = await savedBackend()
    const folder = backend.folders.get('100-0')!
    // the folder's own database copy is gone too (and summary.yaml's path was never served)
    folder.delete('database.fasta')
    const opened = await openSearch(backend, '100-0')
    expect(opened.result.outcome.warnings).toEqual(result.outcome.warnings)
    expect(opened.result.outcome.tables.proteins).toEqual(result.outcome.tables.proteins)
  })

  test('a folder with a record of a newer schema or no record does not open', async () => {
    const backend = await savedBackend()
    const folder = backend.folders.get('100-0')!
    folder.set('search.json', strToU8(JSON.stringify({ ...recordOf(result, 'x', '1'), schema: 7 })))
    await expect(openSearch(backend, '100-0')).rejects.toThrow(/newer version of ProSE \(schema 7\)/)
    folder.delete('search.json')
    await expect(openSearch(backend, '100-0')).rejects.toThrow(ProjectError)
  })
})

describe('project files', () => {
  test('a project round-trips (export, import, same tables)', async () => {
    const backend = await savedBackend('100-0', 'My search')
    expect(await exportProject(backend, '100-0', 'My search')).toBe('/saved/My_search.prose')
    const [{ name, bytes }] = backend.saved
    expect(name).toBe('My_search.prose')
    // a zip of the folder's files, search.json first, no links
    const zipped = unpackProject(bytes)
    expect(zipped[0].name).toBe('search.json')
    expect(zipped.map((e) => e.name).sort()).toEqual(Object.keys(Object.fromEntries(backend.folders.get('100-0')!)).sort())

    // another computer: a fresh backend, the file chosen in the open dialog
    const other = new MemoryBackend()
    other.projects.set('/home/me/My_search.prose', bytes)
    other.chosen = '/home/me/My_search.prose'
    const id = await importProject(other)
    expect(id).not.toBeNull()
    expect(id).not.toBe('100-0')
    const [entry] = await other.list()
    expect(entry).toMatchObject({ id, name: 'My search', files: ['DatabaseSuitability_1.mzML', 'DatabaseSuitability_2.mzML'], database: 'human.fasta', error: null })
    // the FASTA is not on this computer
    other.folders.get(id!)!.delete('database.fasta')
    const opened = await openSearch(other, id!)
    expect(opened.result.outcome.tables).toEqual(result.outcome.tables)
    expect(opened.result.outcome.spectra).toEqual(result.outcome.spectra)
    expect(opened.result.outcome.summary).toEqual(result.outcome.summary)
    expect(opened.origin.id).toBe(id)
    expect(opened.result.stored?.name).toBe('My search')
  })

  test('the project of a search that is not saved is refused', async () => {
    const backend = new MemoryBackend()
    backend.addFolder('1-0', fixture)
    await expect(exportProject(backend, '1-0', 'x')).rejects.toThrow(/not saved to History/)
    expect(backend.saved).toEqual([])
  })

  test('a cancelled save dialog or open dialog does nothing', async () => {
    const backend = await savedBackend()
    backend.cancelSave = true
    expect(await exportProject(backend, '100-0', 'x')).toBeNull()
    expect(await importProject(backend)).toBeNull()
    expect(backend.imported).toBe(0)
  })

  test('parquet is stored, the rest deflated', async () => {
    const backend = await savedBackend()
    await exportProject(backend, '100-0', 'x')
    const bytes = backend.saved[0].bytes
    // the method of each local entry: 0 stored, 8 deflated
    const view = new DataView(bytes.buffer, bytes.byteOffset)
    const methods = new Map<string, number>()
    for (let at = 0; at + 30 < bytes.length && view.getUint32(at, true) === 0x04034b50; ) {
      const method = view.getUint16(at + 8, true)
      const compressed = view.getUint32(at + 18, true)
      const nameLength = view.getUint16(at + 26, true)
      const extra = view.getUint16(at + 28, true)
      methods.set(new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength)), method)
      at += 30 + nameLength + extra + compressed
    }
    expect(methods.get('qpx/1__DatabaseSuitability_1.psm.parquet')).toBe(0)
    expect(methods.get('summary.yaml')).toBe(8)
  })

  test('a newer schema is refused with a message, and nothing is written', async () => {
    const newer = zipSync({ 'search.json': strToU8(JSON.stringify({ ...recordOf(result, 'x', '1'), schema: 2 })), 'a.txt': strToU8('x') })
    const backend = new MemoryBackend()
    await expect(importProjectBytes(backend, newer)).rejects.toThrow(/This project was saved by a newer version of ProSE \(schema 2\)/)
    await expect(importProjectBytes(backend, newer)).rejects.toBeInstanceOf(ProjectVersionError)
    expect(backend.imported).toBe(0)
  })

  const record = () => JSON.stringify(recordOf(result, 'x', '1'))

  test('something that is not a project is refused with a message', async () => {
    const backend = new MemoryBackend()
    await expect(importProjectBytes(backend, strToU8('hello, this is text and not a zip file at all'))).rejects.toThrow(/not a zip file/)
    await expect(importProjectBytes(backend, new Uint8Array(0))).rejects.toThrow(/not a zip file/)
    const damaged = zipSync({ 'search.json': strToU8('x'.repeat(1000)) })
    damaged.fill(0xff, damaged.length - 40, damaged.length - 22) // the central directory
    await expect(importProjectBytes(backend, damaged)).rejects.toThrow(ProjectError)
    await expect(importProjectBytes(backend, zipSync({ 'a.txt': strToU8('x') }))).rejects.toThrow(/no search.json/)
    await expect(importProjectBytes(backend, zipSync({ 'search.json': strToU8('{ no') }))).rejects.toThrow(/not valid JSON/)
    await expect(importProjectBytes(backend, zipSync({ 'search.json': strToU8('{}') }))).rejects.toThrow(/no schema/)
    expect(backend.imported).toBe(0)
  })

  test('names outside the folder are refused before anything is written', async () => {
    const backend = new MemoryBackend()
    const bad = ['../escape.txt', 'a/../../escape.txt', '/etc/passwd', 'a//b', './a', 'a/./b', 'a\\b', 'C:evil', 'with\nnewline']
    for (const name of bad) {
      const zip = zipSync({ 'search.json': strToU8(record()), [name]: strToU8('x') })
      await expect(importProjectBytes(backend, zip), name).rejects.toThrow(/not a plain name/)
    }
    // a file that is also a folder
    const clash = zipSync({ 'search.json': strToU8(record()), a: strToU8('x'), 'a/b': strToU8('y') })
    await expect(importProjectBytes(backend, clash)).rejects.toThrow(/as a file and as a folder/)
    expect(backend.imported).toBe(0)
    // plain names, folders included, are fine
    expect(unpackProject(zipSync({ 'search.json': strToU8(record()), 'qpx/a b.parquet': strToU8('x'), 'mods/deep/x.txt': strToU8('y') })).length).toBe(3)
  })

  test('a link in the zip is refused', async () => {
    // a zip as `zip -y` makes it: the link's entry is made on Unix with the mode of a symbolic link
    const zip = zipSync({ 'search.json': strToU8(record()), link: [strToU8('/etc/passwd'), { os: 3, attrs: 0o120777 << 16 }] })
    expect(() => unpackProject(zip)).toThrow(/contains a link/)
    // a regular file made on Unix is fine
    const fine = zipSync({ 'search.json': [strToU8(record()), { os: 3, attrs: 0o100644 << 16 }] })
    expect(unpackProject(fine).length).toBe(1)
  })

  test('folders in the zip are skipped, not written', () => {
    const zip = zipSync({ 'search.json': strToU8(record()), 'qpx/': new Uint8Array(0), 'qpx/a.txt': strToU8('x') })
    expect(unpackProject(zip).map((e) => e.name).sort()).toEqual(['qpx/a.txt', 'search.json'])
  })

  test('plain names: the rule of the Rust side', () => {
    for (const ok of ['a', 'a/b.parquet', 'qpx/1__a b.psm.parquet', 'ü/ö']) expect(isPlainName(ok), ok).toBe(true)
    for (const bad of ['', '/a', 'a/', '..', 'a/..', '.', 'a/./b', 'a//b', 'a\\b', 'c:/x', 'a\u0000b', 'a\u007fb', 'a\u0085b']) {
      expect(isPlainName(bad), JSON.stringify(bad)).toBe(false)
    }
  })

  test('project names are reduced to safe file names', () => {
    expect(projectFileName('My search #1')).toBe('My_search_1.prose')
    expect(projectFileName('../etc/passwd')).toBe('etc_passwd.prose')
    expect(projectFileName('???')).toBe('prose-results.prose')
    expect(projectFileName('DatabaseSuitability.v2')).toBe('DatabaseSuitability.v2.prose')
  })

  test('the entries are framed as the Rust side reads them', () => {
    // the same bytes as the Rust test `frames_have_a_fixed_layout`
    expect([...frameEntries([{ name: 'ab', data: strToU8('xyz') }])]).toEqual([0, 0, 0, 2, 97, 98, 0, 0, 0, 0, 0, 0, 0, 3, 120, 121, 122])
    const entries = [
      { name: 'search.json', data: strToU8('{}') },
      { name: 'qpx/ü.parquet', data: new Uint8Array([0, 255, 7]) },
      { name: 'empty', data: new Uint8Array(0) },
    ]
    expect(unframe(frameEntries(entries))).toEqual(entries)
  })
})
