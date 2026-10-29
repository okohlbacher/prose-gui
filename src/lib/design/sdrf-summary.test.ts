import { expect, test } from 'vitest'
import { readableTerm, sdrfSummary } from './sdrf-summary'
import { parseSdrfTable } from './sdrf-table'

const text = [
  'source name\tcharacteristics[organism]\tcharacteristics[disease]\tassay name\tcomment[instrument]\tcomment[label]\tcomment[modification parameters]\tcomment[modification parameters]\tcomment[data file]\tfactor value[treatment]',
  's1\tHomo sapiens\tnormal\trun 1\tNT=Orbitrap Fusion;AC=MS:1002416\tAC=MS:1002038;NT=label free sample\tNT=Carbamidomethyl;AC=UNIMOD:4;TA=C;MT=fixed\tNT=Oxidation;MT=variable;TA=M;AC=UNIMOD:35\ta.raw\tcontrol',
  's2\tHomo sapiens\tnot available\trun 2\tNT=Orbitrap Fusion;AC=MS:1002416\tAC=MS:1002038;NT=label free sample\tNT=Carbamidomethyl;AC=UNIMOD:4;TA=C;MT=fixed\tNT=Oxidation;MT=variable;TA=M;AC=UNIMOD:35\tb.raw\tEGF',
].join('\n')

test('ontology values read as names, counted over the rows', () => {
  expect(readableTerm('NT=Orbitrap Fusion;AC=MS:1002416')).toBe('Orbitrap Fusion (MS:1002416)')
  expect(readableTerm('NT=Oxidation;MT=variable;TA=M;AC=UNIMOD:35')).toBe('Oxidation, variable on M (UNIMOD:35)')
  expect(readableTerm('Homo sapiens')).toBe('Homo sapiens')
  const s = sdrfSummary(parseSdrfTable(text))
  const get = (title: string, label: string) => s.find((x) => x.title === title)!.items.find((i) => i.label === label)!
  expect(get('Samples', 'Organism').values).toEqual([{ value: 'Homo sapiens', rows: 2 }])
  expect(get('Samples', 'Disease').values.map((v) => v.value)).toEqual(['normal', 'not available'])
  expect(get('Measurement', 'Instrument').values).toEqual([{ value: 'Orbitrap Fusion (MS:1002416)', rows: 2 }])
  expect(get('Measurement', 'Modifications').values).toHaveLength(2)
  expect(get('Factors of the design', 'treatment').values.map((v) => v.value).sort()).toEqual(['EGF', 'control'])
  expect(get('Study', 'Size').values[0].value).toBe('2 rows · 2 samples (source names) · 2 data files')
})
