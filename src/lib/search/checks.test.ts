import { describe, expect, test } from 'vitest'
import { accept, unaccept, acceptedKeys, acceptedOf, firstBlock, ionTrapPpm, isAccepted, loadAccepted, startChecks, warnedOf, withoutExpected, type Check, type StartState } from './checks'

// The check registry of New search: the start checks in their order, red flags that can be searched anyway (once
// per file, kept on this computer), and checks a preset expects.

const ready: StartState = {
  files: [{ path: '/r/a.mzML', name: 'a.mzML', problem: null }],
  adding: false,
  inspecting: false,
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
  test('Start waits while the spectra are checked (their red flags are not known yet)', () => {
    expect(startChecks({ ...ready, inspecting: true }).map((c) => c.id)).toEqual(['inspecting'])
    expect(startChecks({ ...ready, adding: true, inspecting: true }).map((c) => c.id)).toEqual(['adding'])
  })
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
    // a settings field that shows a value the search would not use holds Start
    expect(startChecks({ ...ready, invalidField: { label: 'Missed cleavages', text: '2.5', hint: 'A whole number, at least 0' } })[0]).toMatchObject({
      id: 'setting-invalid',
      level: 'block',
      message: 'Missed cleavages: “2.5” is not valid (a whole number, at least 0). Correct it to start.',
    })
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
    // "Ask again" forgets it, on this computer too
    expect(isAccepted(profile, unaccept(profile, accepted, storage))).toBe(false)
    expect(isAccepted(profile, loadAccepted(storage))).toBe(false)
    accepted = accept(profile, loadAccepted(storage), storage)
    // a third file is not accepted yet
    expect(isAccepted({ ...profile, files: [...profile.files!, '/r/c.mzML'] }, accepted)).toBe(false)
    // a plain block stays a block
    const block: Check = { id: 'no-database', level: 'block', source: 'database', message: 'x' }
    expect(isAccepted(block, accept(block, accepted, storage))).toBe(false)
    // the record of the search, and back into New search
    expect(acceptedOf([profile], accepted)).toEqual([{ id: 'profile-ms2', files: profile.files, message: 'Profile.', stamps: Object.fromEntries(profile.files!.map((p) => [p, ''])) }])
    expect(isAccepted(profile, new Set(acceptedKeys(acceptedOf([profile], accepted))))).toBe(true)
  })

  test('an accepted red flag holds for the version of the file it was accepted for: a changed file is asked again', () => {
    const storage = memory()
    let version = '1000:1'
    const stamp = () => version
    const accepted = accept(profile, loadAccepted(storage), storage, stamp)
    expect(isAccepted(profile, accepted, stamp)).toBe(true)
    version = '1200:2' // rewritten (converted again, say)
    expect(isAccepted(profile, accepted, stamp)).toBe(false)
    expect(firstBlock([profile], accepted, stamp)).toBe(profile)
    // Re-run: the record keeps the version accepted then, so a file changed since is asked about again
    version = '1000:1'
    const record = acceptedOf([profile], accepted, stamp)
    version = '1200:2'
    expect(isAccepted(profile, new Set(acceptedKeys(record)), stamp)).toBe(false)
    version = '1000:1'
    expect(isAccepted(profile, new Set(acceptedKeys(record)), stamp)).toBe(true)
  })

  test('the advice shown (warn and info) is recorded with the search; blocks are not', () => {
    const warn: Check = { id: 'iontrap-ppm', level: 'warn', source: 'settings', message: 'Ion trap.', files: ['/r/a.mzML'], action: { label: 'x', run: () => {} } }
    const info: Check = { id: 'no-charge', level: 'info', source: 'spectra', message: 'No charge.' }
    expect(warnedOf([profile, warn, info])).toEqual([
      { id: 'iontrap-ppm', files: ['/r/a.mzML'], message: 'Ion trap.' },
      { id: 'no-charge', files: [], message: 'No charge.' },
    ])
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

describe('ion-trap fragments in ppm', () => {
  const f = (instrument: string | null, ms2Analyzer: string | null = null) => ({ path: `/r/${instrument}`, name: `${instrument}.mzML`, instrument, ms2Analyzer })
  test('an ion-trap model with a ppm fragment tolerance is warned, with the fix', () => {
    let set = false
    const c = ionTrapPpm([f('LTQ')], 'ppm', () => (set = true))
    expect(c).toMatchObject({ id: 'iontrap-ppm', level: 'warn', files: ['/r/LTQ'] })
    expect(c!.message).toMatch(/^LTQ\.mzML was measured with ion-trap MS2/)
    c!.action!.run()
    expect(set).toBe(true)
    expect(ionTrapPpm([f('LTQ')], 'Da', () => {})).toBeNull()
  })
  test('a hybrid counts only when its MS2 analyzer is the ion trap', () => {
    expect(ionTrapPpm([f('LTQ Orbitrap XL')], 'ppm', () => {})).toBeNull()
    expect(ionTrapPpm([f('LTQ Orbitrap XL', 'radial ejection linear ion trap'), f('Q Exactive')], 'ppm', () => {})!.message).toMatch(/^1 of 2 files were/)
    expect(ionTrapPpm([f('Orbitrap Fusion Lumos', 'orbitrap')], 'ppm', () => {})).toBeNull()
  })
})
