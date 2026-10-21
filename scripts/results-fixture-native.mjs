// Makes a fixture of the results reader (src/lib/results/fixtures/<case>/): a search of
// scripts/results-example.mjs by the pinned ProSE tool, in a search folder as the shim makes it
// (src-tauri/src/args.rs `build_args`, `with_contaminants`, `input_records`; run.rs `prepare_folder`).
//
//   node scripts/results-fixture-native.mjs <case> <ProSE>        (case: example, mods, open, empty)
//
// The fixture keeps what the reader reads: summary.yaml, inputs.json (with the paths of the inputs
// replaced by /data/<name>), database.fasta (with the contaminants, as the shim writes it; without, the
// search reads the user's FASTA, kept as user/<name>), qpx/, spectra/, oms/, mods/. Not
// kept: the links to the inputs, prose.log, merged.idXML and, of several inputs, the concatenated
// quantms/openms files. OUT=<dir> writes it elsewhere, KEEP=1 keeps the search folder.

import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { CRAP, getCase } from './results-example.mjs'

const [caseName, prose] = process.argv.slice(2)
if (!caseName || !prose) {
  console.error('usage: node scripts/results-fixture-native.mjs <case> <ProSE>')
  process.exit(2)
}
const search = getCase(caseName)
const here = new URL('..', import.meta.url).pathname
const fixture = process.env.OUT ?? join(here, 'src/lib/results/fixtures', caseName)

/** args.rs DEFAULT_PSM_FDR, is_open_search */
const parameters = { 'FDR:PSM': 0.01, ...search.parameters }
const p = parameters
const window = Math.max(p['precursor:mass_tolerance_lower'] ?? 10, p['precursor:mass_tolerance_upper'] ?? 10)
const openSearch = window > ((p['precursor:mass_tolerance_unit'] ?? 'ppm') === 'ppm' ? 1000 : 1)

const work = mkdtempSync(join(tmpdir(), 'prose-fixture-'))
try {
  // the user's files: the mzML under each name
  const data = join(work, 'data')
  mkdirSync(data)
  const paths = search.names.map((name) => {
    const path = join(data, name)
    symlinkSync(search.mzML, path)
    return path
  })

  // the search folder (run.rs prepare_folder)
  const dir = join(work, 'search')
  mkdirSync(dir)
  const records = paths.map((path, index) => {
    const name = search.names[index]
    const link = `${index + 1}__${name}`
    symlinkSync(path, join(dir, link))
    return { id: `f${index + 1}`, index, link, stem: link.replace(/\.gz$/i, '').replace(/\.mzml$/i, ''), name, path }
  })
  writeFileSync(join(dir, 'inputs.json'), JSON.stringify(records, null, 2))
  let database = search.fasta
  if (search.contaminants) {
    // args.rs with_contaminants
    let user = readFileSync(search.fasta, 'utf8')
    if (!user.endsWith('\n')) user += '\n'
    const crap = readFileSync(CRAP, 'utf8').replace(/^>(?!CON__)/gm, '>CON__')
    database = join(dir, 'database.fasta')
    writeFileSync(database, user + crap)
  }

  // args.rs build_args
  const args = ['-in', ...records.map((r) => join(dir, r.link)), '-database', database]
  for (const [flag, name] of [['-out_qpx', 'qpx'], ['-out_psm_spectra', 'spectra'], ['-out_parquet', 'oms'], ['-summary_out', 'summary.yaml']]) {
    args.push(flag, join(dir, name))
  }
  args.push('-keep_decoys')
  if (records.length > 1) args.push('-out_merged', join(dir, 'merged.idXML'))
  if (openSearch) args.push('-out_mod_analysis_dir', join(dir, 'mods'))
  args.push('-threads', '4', '-Search:rescore', String(search.rescore))
  if (search.peptdeep && process.env.PEPTDEEP !== '0') args.push('-Search:peptdeep:enable')
  for (const [name, value] of Object.entries(parameters)) {
    args.push(`-Search:${name}`, ...(Array.isArray(value) ? value : [String(value)]))
  }
  console.log(['$', prose, ...args].join(' '))
  const run = spawnSync(prose, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, OPENBLAS_NUM_THREADS: '1' } })
  writeFileSync(join(dir, 'prose.log'), Buffer.concat([run.stdout ?? Buffer.alloc(0), run.stderr ?? Buffer.alloc(0)]))
  if (run.status !== 0) {
    console.error(readFileSync(join(dir, 'prose.log'), 'utf8').slice(-4000))
    throw new Error(`ProSE ended with ${run.status ?? run.signal}`)
  }

  rmSync(fixture, { recursive: true, force: true })
  mkdirSync(fixture, { recursive: true })
  const kept = records.map((r) => ({ ...r, path: `/data/${r.name}` }))
  writeFileSync(join(fixture, 'inputs.json'), JSON.stringify(kept, null, 2) + '\n')
  if (search.contaminants) cpSync(database, join(fixture, 'database.fasta'))
  else cpSync(database, join(fixture, 'user', basename(database)), { recursive: true })
  cpSync(join(dir, 'summary.yaml'), join(fixture, 'summary.yaml'))
  for (const sub of ['qpx', 'spectra', 'oms', 'mods']) {
    let files
    try {
      files = readdirSync(join(dir, sub))
    } catch {
      continue
    }
    mkdirSync(join(fixture, sub))
    for (const file of files) {
      if (/^(quantms|openms)\./.test(file)) continue
      cpSync(join(dir, sub, file), join(fixture, sub, file))
    }
  }
  console.log(`fixture written to ${fixture}`)
} finally {
  if (!process.env.KEEP) rmSync(work, { recursive: true, force: true })
  else console.log(`kept ${work}`)
}
