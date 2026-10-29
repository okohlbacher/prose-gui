import { describe, expect, test } from 'vitest'
import { accept, acceptedKeys, acceptedOf, firstBlock, isAccepted, loadAccepted, startChecks, withoutExpected, type Check, type StartState } from './checks'

// The check registry of New search: the start checks in their order, red flags that can be searched anyway (once
// per file, kept on this computer), and checks a preset expects.

const ready: StartState = {
  files: [{ path: '/r/a.mzML', name: 'a.mzML', problem: null }],
  adding: false,
  sdrfProblem: null,
  invalidCell: null,
  database: { name: 'db.fasta', error: null, counted: true, problem: null },
  inverted: null,
  outside: null,
  psmFdrMissing: false,
  unknownMods: null,
  toolError: null,
}

function memory() {
  const items = new Map<string, string>()
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) }
}

const profile: Check = { id: 'profile-ms2', level: 'block', overridable: true, source: 'spectra', message: 'Profile.', files: ['/r/a.mzML', '/r/b.mzML'] }

describe('the start checks', () => {
  test('a ready form has none; the order and wording of the plan line are kept', () => {
    expect(startChecks(ready)).toEqual([])
    const all = startChecks({
      ...ready,
      files: [
        { path: '/r/a.mzML', name: 'a.mzML', problem: 'a.mzML is cut off.' },
        { path: '/r/b.mzML', name: 'b.mzML', problem: null },
      ],
      database: null,
      psmFdrMissing: true,
      toolError: 'PROSE_BIN is not a file.',
    })
    expect(all.map((c) => c.id)).toEqual(['file-problem', 'no-database', 'psm-fdr', 'tool'])
    expect(all[0]).toMatchObject({ level: 'block', message: 'a.mzML is cut off. Remove it to start the search.', files: ['/r/a.mzML'] })
    expect(firstBlock(all, new Set())?.message).toBe('a.mzML is cut off. Remove it to start the search.')
    expect(startChecks({ ...ready, invalidCell: { label: 'Replicate of a.mzML', text: 'x', more: 2 } })[0].message).toBe(
      'Replicate of a.mzML (and 2 more): “x” is not a whole number of at least 1. Correct it, or empty the cell.',
    )
  })

  test('a red flag blocks until it is accepted for every file it names; other blocks cannot be accepted', () => {
    const storage = memory()
    let accepted = loadAccepted(storage)
    expect(firstBlock([profile], accepted)).toBe(profile)
    accepted = accept(profile, accepted, storage)
    expect(isAccepted(profile, accepted)).toBe(true)
    expect(firstBlock([profile], accepted)).toBeNull()
    // kept on this computer: a new session knows it
    expect(isAccepted(profile, loadAccepted(storage))).toBe(true)
    // a third file is not accepted yet
    expect(isAccepted({ ...profile, files: [...profile.files!, '/r/c.mzML'] }, accepted)).toBe(false)
    // a plain block stays a block
    const block: Check = { id: 'no-database', level: 'block', source: 'database', message: 'x' }
    expect(isAccepted(block, accept(block, accepted, storage))).toBe(false)
    // the record of the search, and back into New search
    expect(acceptedOf([profile], accepted)).toEqual([{ id: 'profile-ms2', files: profile.files, message: 'Profile.' }])
    expect(isAccepted(profile, new Set(acceptedKeys(acceptedOf([profile], accepted))))).toBe(true)
  })

  test('a broken storage accepts nothing and does not fail', () => {
    expect(loadAccepted({ getItem: () => '{oops', setItem: () => {} }).size).toBe(0)
    expect(loadAccepted(null).size).toBe(0)
    const throwing = { getItem: () => null, setItem: () => { throw new Error('full') } }
    expect(isAccepted(profile, accept(profile, new Set(), throwing))).toBe(true)
  })

  test('a preset leaves out the checks it expects, never a plain block', () => {
    const warn: Check = { id: 'iontrap-ppm', level: 'warn', source: 'settings', message: 'w' }
    const block: Check = { id: 'no-database', level: 'block', source: 'database', message: 'b' }
    expect(withoutExpected([warn, block, profile], ['iontrap-ppm', 'no-database', 'profile-ms2'])).toEqual([block])
    expect(withoutExpected([warn], undefined)).toEqual([warn])
  })
})
