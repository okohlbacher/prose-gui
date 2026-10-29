// What "Download missing" fetches: each data file that is not here, from its comment[file uri] or else from the
// file list of the project in PRIDE (by name, any case), with its associated files (comment[associated data
// file], paired by position with comment[associated file uri]).

import { cell, column, columns, dataRows, noValue, type SdrfTable } from './sdrf-table'

export type RemoteFile = { name: string; size: number; url: string }

/** The project's ProteomeXchange accession: its comment[proteomexchange accession number], else one in the SDRF's file name. */
export function accessionOf(t: SdrfTable, fileName: string): string {
  const col = column(t, 'comment[proteomexchange accession number]')
  for (const r of dataRows(t)) {
    const v = cell(t, r, col)
    if (/^(PXD|MSV)\d+$/.test(v)) return v
  }
  return /(PXD\d{6,})/.exec(fileName)?.[1] ?? ''
}

const remote = (uri: string) => /^(https?|ftp):\/\//i.test(uri)
const https = (url: string) => url.replace(/^ftp:\/\/ftp\.pride\.ebi\.ac\.uk\//, 'https://ftp.pride.ebi.ac.uk/')

/** The files to download for the data files `names` (those not found), and the names nothing was found for. */
export function downloadPlan(t: SdrfTable, names: string[], pride: RemoteFile[]): { files: RemoteFile[]; notFound: string[] } {
  const fileCol = column(t, 'comment[data file]')
  const uriCol = column(t, 'comment[file uri]')
  const assocFiles = columns(t, 'comment[associated data file]')
  const assocUris = columns(t, 'comment[associated file uri]')
  const inPride = new Map(pride.map((f) => [f.name.toLowerCase(), f]))
  const files = new Map<string, RemoteFile>()
  const notFound: string[] = []
  const want = (name: string, uri: string) => {
    if (files.has(name)) return true
    const listed = inPride.get(name.toLowerCase())
    const file = remote(uri) ? { name, size: listed?.size ?? 0, url: https(uri) } : listed && { ...listed, name }
    if (file) files.set(name, file)
    return !!file
  }
  for (const name of names) {
    const rows = dataRows(t).filter((r) => cell(t, r, fileCol) === name)
    if (!want(name, rows.map((r) => cell(t, r, uriCol)).find(remote) ?? '')) notFound.push(name)
    for (const r of rows) {
      assocFiles.forEach((c, k) => {
        const assoc = cell(t, r, c)
        if (assoc !== '' && !noValue(assoc) && !want(assoc, cell(t, r, assocUris[k] ?? -1))) notFound.push(assoc)
      })
    }
  }
  return { files: [...files.values()], notFound: [...new Set(notFound)] }
}

/** The command that converts a vendor file ProSE cannot read into mzML. */
export function convertCommand(path: string): string {
  return /\.raw$/i.test(path)
    ? `ThermoRawFileParser -i "${path}" -f 2`
    : `msconvert --mzML --zlib "${path}"`
}
