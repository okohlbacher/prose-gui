import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { accessionOf, convertCommand, downloadPlan } from './sdrf-download'
import { parseSdrfTable } from './sdrf-table'

const fixture = (name: string) => readFileSync(new URL(`./sdrf-fixtures/${name}`, import.meta.url), 'utf8')

describe('downloadPlan', () => {
  it('takes the file URI over HTTPS (PRIDE FTP made HTTPS, other FTP refused) and pairs the associated files by position', () => {
    const t = parseSdrfTable(fixture('lfq.sdrf.tsv'))
    const plan = downloadPlan(t, ['A1.wiff', 'B1.d'], [])
    expect(plan.files).toEqual([
      { name: 'A1.wiff', size: 0, url: 'https://ftp.pride.ebi.ac.uk/pride/data/archive/2020/01/PXD000001/A1.wiff' },
    ])
    // ftp://x/A1.wiff.scan is no HTTPS address
    expect(plan.notFound).toEqual(['A1.wiff.scan', 'B1.d'])
    const https = parseSdrfTable(fixture('lfq.sdrf.tsv').replace('ftp://x/A1.wiff.scan', 'https://x/A1.wiff.scan'))
    expect(downloadPlan(https, ['A1.wiff'], []).files[1]).toEqual({ name: 'A1.wiff.scan', size: 0, url: 'https://x/A1.wiff.scan' })
  })

  it('finds the rest in the PRIDE file list, by name in any case', () => {
    const t = parseSdrfTable(fixture('ecoli.sdrf.tsv'))
    const pride = [{ name: 'ecoli_3.mzML', size: 10, url: 'https://ftp.pride.ebi.ac.uk/x/ecoli_3.mzML' }]
    expect(downloadPlan(t, ['Ecoli_3.mzML'], pride)).toEqual({
      files: [{ name: 'Ecoli_3.mzML', size: 10, url: 'https://ftp.pride.ebi.ac.uk/x/ecoli_3.mzML' }],
      notFound: [],
    })
  })

  it('finds the accession in a column or in the file name', () => {
    const t = parseSdrfTable('source name\tcomment[proteomexchange accession number]\ns\tPXD012345\n')
    expect(accessionOf(t, 'x.tsv')).toBe('PXD012345')
    expect(accessionOf(parseSdrfTable(fixture('tmt.sdrf.tsv')), 'PXD000001_community_annotated.sdrf.tsv')).toBe('PXD000001')
    expect(convertCommand('/d/a.raw')).toBe('ThermoRawFileParser -i "/d/a.raw" -f 2')
    expect(convertCommand('/d/a.wiff')).toBe('msconvert --mzML --zlib "/d/a.wiff"')
  })
})
