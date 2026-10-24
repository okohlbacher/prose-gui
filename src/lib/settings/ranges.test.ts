import { describe, expect, test } from 'vitest'
import { PROSE_PARAMETERS } from './prose'
import { invertedRanges, isInverted, rangeMessage, rangeOf, RANGES } from './ranges'

describe('parameter ranges', () => {
  test('every range is a pair of ProSE parameters, and the defaults are not inverted', () => {
    const names = new Set(PROSE_PARAMETERS.map((e) => e.name))
    for (const r of RANGES) {
      expect(names.has(r.min), r.min).toBe(true)
      expect(names.has(r.max), r.max).toBe(true)
    }
    const defaults = Object.fromEntries(PROSE_PARAMETERS.map((e) => [e.name, e.value]))
    expect(invertedRanges(defaults)).toEqual([])
  })

  test('a lowest value above the highest is inverted; equal ones are a range of one', () => {
    const charges = rangeOf('precursor:max_charge')!
    expect(isInverted(charges, { 'precursor:min_charge': 5, 'precursor:max_charge': 2 })).toBe(true)
    expect(isInverted(charges, { 'precursor:min_charge': 3, 'precursor:max_charge': 3 })).toBe(false)
    expect(rangeMessage(charges, { 'precursor:min_charge': 5, 'precursor:max_charge': 2 })).toBe(
      'Charges: the lowest (5) is above the highest (2).',
    )
    const values = { 'peptide:min_size': 40, 'peptide:max_size': 7, 'fragment:min_mz': 2000, 'fragment:max_mz': 150 }
    expect(invertedRanges(values).map((r) => r.label)).toEqual(['Peptide length', 'Fragment m/z'])
  })

  test('a highest value of "no limit", or a value that is not a number, is no inverted range', () => {
    expect(invertedRanges({ 'peptide:min_size': 7, 'peptide:max_size': 0 })).toEqual([])
    expect(invertedRanges({ 'precursor:min_charge': 5, 'precursor:max_charge': undefined })).toEqual([])
    expect(invertedRanges({ 'precursor:min_charge': Number.NaN, 'precursor:max_charge': 2 })).toEqual([])
  })
})
