import { describe, expect, it } from 'vitest'
import { applyDesign, designFromNames, matchFiles, parsePastedDesign } from './paste'

const files = ['ctrl_a_F1.mzML', 'ctrl_a_F2.mzML', 'egf_30min.mzML']

describe('parsePastedDesign', () => {
  it('reads columns by their header, in any order', () => {
    const text = 'Fraction\tFile\tCondition\tReplicate\n1\tctrl_a_F1.mzML\tcontrol\t1\n2\tctrl_a_F2.mzML\tcontrol\t1\n'
    const { rows, notices } = parsePastedDesign(text, files)
    expect(notices).toEqual([])
    expect(rows).toEqual([
      { index: 0, fields: { condition: 'control', replicate: 1, fraction: 1 } },
      { index: 1, fields: { condition: 'control', replicate: 1, fraction: 2 } },
    ])
  })

  it('reads File, Condition, Replicate, Fraction without a header', () => {
    const text = 'egf_30min\tEGF\t\t\r\nctrl_a_F1.mzML\tcontrol\t2\t1'
    const { rows } = parsePastedDesign(text, files)
    // matched by name or by stem; an empty cell clears the field
    expect(rows).toEqual([
      { index: 2, fields: { condition: 'EGF', replicate: undefined, fraction: undefined } },
      { index: 0, fields: { condition: 'control', replicate: 2, fraction: 1 } },
    ])
  })

  it('takes rows without file names in table order when there is one per file', () => {
    const { rows, notices } = parsePastedDesign('control\t1\ncontrol\t2\nEGF\t1\n', files)
    expect(notices).toEqual([])
    expect(rows.map((r) => [r.index, r.fields])).toEqual([
      [0, { condition: 'control', replicate: 1 }],
      [1, { condition: 'control', replicate: 2 }],
      [2, { condition: 'EGF', replicate: 1 }],
    ])
  })

  it('says what it could not use', () => {
    expect(parsePastedDesign('control\t1\n', files).notices).toEqual([
      'The pasted rows name no files, and there are 1 rows for 3 files. Paste one row per file, or include a column of file names.',
    ])
    const unknown = parsePastedDesign('File\tCondition\nother.mzML\tx\nctrl_a_F1.mzML\ty', files)
    expect(unknown.rows).toEqual([{ index: 0, fields: { condition: 'y' } }])
    expect(unknown.notices).toEqual(['Not in the table: other.mzML.'])
    expect(parsePastedDesign('  \n', files).notices).toEqual(['Nothing to paste.'])
  })

  it('does not take a row of file names for a header', () => {
    const named = ['first_file.mzML', 'second_file.mzML']
    const { rows } = parsePastedDesign('first_file.mzML\tgroup A\nsecond_file.mzML\tgroup B', named)
    expect(rows).toEqual([
      { index: 0, fields: { condition: 'group A' } },
      { index: 1, fields: { condition: 'group B' } },
    ])
  })

  it('reads the MaxQuant layout: Name, Fraction, Experiment, PTM', () => {
    const text = 'Name\tFraction\tExperiment\tPTM\nctrl_a_F1\t1\tcontrol\tFalse\nctrl_a_F2\t2\tcontrol\tFalse\n'
    expect(parsePastedDesign(text, files).rows).toEqual([
      { index: 0, fields: { fraction: 1, condition: 'control' } },
      { index: 1, fields: { fraction: 2, condition: 'control' } },
    ])
  })

  it('reads a technical replicate column', () => {
    const { rows } = parsePastedDesign('File\tTech. replicate\nctrl_a_F1.mzML\t2', files)
    expect(rows).toEqual([{ index: 0, fields: { techReplicate: 2 } }])
  })
})

describe('matchFiles', () => {
  it('matches by name, then by stem (any case), ignoring folders', () => {
    expect(matchFiles(['/data/ctrl_a_F2.mzML', 'EGF_30MIN.raw', 'nope.mzML'], files)).toEqual([1, 2, -1])
  })

  it('gives each file of the table to one row only', () => {
    expect(matchFiles(['run.mzML', 'run.mzML', 'run.mzML'], ['run.mzML', 'run.mzML'])).toEqual([0, 1, -1])
  })
})

describe('applyDesign', () => {
  it('applies a loaded design to the files it names and reports the rest', () => {
    const result = applyDesign(
      [
        { fileName: 'ctrl_a_F1.raw', condition: 'control', replicate: 1, fraction: 1 },
        { fileName: 'missing.raw', condition: 'control', replicate: 2 },
      ],
      files,
    )
    expect(result.rows).toEqual([
      { index: 0, fields: { condition: 'control', replicate: 1, fraction: 1, techReplicate: undefined } },
    ])
    expect(result.notices).toEqual([
      'Not in the table: missing.raw.',
      'Not in the design (left as they were): ctrl_a_F2.mzML, egf_30min.mzML.',
    ])
  })
})

describe('designFromNames', () => {
  const fields = (names: string[]) => designFromNames(names)?.map((u) => u.fields) ?? null

  it('reads conditions, replicates and fractions; parts all names share are left out', () => {
    expect(fields(['HeLa_ctrl_R1_F1.raw', 'HeLa_ctrl_R2_F1.raw', 'HeLa_EGF_R1_F02.raw', 'HeLa_EGF_R2_F02.raw'])).toEqual([
      { condition: 'ctrl', replicate: 1, fraction: 1 },
      { condition: 'ctrl', replicate: 2, fraction: 1 },
      { condition: 'EGF', replicate: 1, fraction: 2 },
      { condition: 'EGF', replicate: 2, fraction: 2 },
    ])
  })

  it('a bare number is the replicate only when every condition has the same ones', () => {
    expect(fields(['ctrl_1.mzML', 'ctrl_2.mzML', 'egf-1.mzML', 'egf-2.mzML'])).toEqual([
      { condition: 'ctrl', replicate: 1 },
      { condition: 'ctrl', replicate: 2 },
      { condition: 'egf', replicate: 1 },
      { condition: 'egf', replicate: 2 },
    ])
    // run numbers
    expect(fields(['ctrl_017.raw', 'ctrl_018.raw', 'egf_019.raw', 'egf_020.raw'])).toEqual([
      { condition: 'ctrl' },
      { condition: 'ctrl' },
      { condition: 'egf' },
      { condition: 'egf' },
    ])
  })

  it('names that tell no design give nothing', () => {
    expect(designFromNames(['run01.mzML', 'run02.mzML'])).toBeNull()
    expect(designFromNames(['sample_1.mzML', 'sample_2.mzML'])).toBeNull()
    expect(designFromNames(['liver.mzML', 'kidney.mzML'])).toBeNull()
  })
})
