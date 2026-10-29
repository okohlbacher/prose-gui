// The questions the vision tests ask, one per screen: fixed prompts and strict schemas (changing a word re-asks,
// since the cache key includes them).
import type { Question, Schema } from './client'

const str: Schema = { type: 'string' }
const strOrNull: Schema = { anyOf: [{ type: 'string' }, { type: 'null' }] }
const numOrNull: Schema = { anyOf: [{ type: 'number' }, { type: 'null' }] }
const bool: Schema = { type: 'boolean' }
const list: Schema = { type: 'array', items: { type: 'string' } }
const COLOURS = ['blue', 'orange', 'red', 'green', 'purple', 'gray', 'black', 'other', 'not shown']
const colour: Schema = { type: 'string', enum: COLOURS }

const object = (properties: Record<string, Schema>): Question['schema'] => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})

export interface SpectrumAnswer {
  peak_labels: string[]
  b_ion_colour: string
  y_ion_colour: string
  x_axis_label: string | null
  y_axis_label: string | null
  y_axis_tick_labels: string[]
  text_clipped_or_overlapping: boolean
  clipped_or_overlapping_items: string[]
}

export const SPECTRUM: Question = {
  name: 'spectrum',
  prompt:
    'This is an annotated MS/MS spectrum (a mirror plot: observed peaks above, a prediction below, and a fragment mass error strip). ' +
    'List every fragment ion label written on or above the peaks of the upper half exactly as written (for example "b4", "y6"), without the legend. ' +
    'Name the colour of the peaks the legend calls "b ions" and of those it calls "y ions". ' +
    'Give the x-axis title and the y-axis title as written (null if there is none) and the tick labels of the upper y axis. ' +
    'Say whether any text is clipped at an edge or overlaps other text so that it cannot be read, and list such text.',
  schema: object({
    peak_labels: list,
    b_ion_colour: colour,
    y_ion_colour: colour,
    x_axis_label: strOrNull,
    y_axis_label: strOrNull,
    y_axis_tick_labels: list,
    text_clipped_or_overlapping: bool,
    clipped_or_overlapping_items: list,
  }),
}

export interface ContrastAnswer {
  readable_contrast: boolean
  low_contrast_items: string[]
  b_ion_colour: string
  y_ion_colour: string
  peak_labels_legible: boolean
}

export const DARK_SPECTRUM: Question = {
  name: 'spectrum-dark',
  prompt:
    'This is the same annotated MS/MS spectrum in a dark theme. Is all text and every line readable against its background ' +
    '(enough contrast for a normal-sighted reader)? List any text or mark with too little contrast. ' +
    'Name the colour of the peaks the legend calls "b ions" and of those it calls "y ions", and say whether the ion labels on the peaks are legible.',
  schema: object({ readable_contrast: bool, low_contrast_items: list, b_ion_colour: colour, y_ion_colour: colour, peak_labels_legible: bool }),
}

export interface PanelAnswer {
  accession: string
  coverage_percent_in_header: number | null
  peptides_in_header: number | null
  psms_in_header: number | null
  coverage_map_visible: boolean
  text_clipped_or_overlapping: boolean
  clipped_or_overlapping_items: string[]
}

export const PROTEIN_PANEL: Question = {
  name: 'protein-panel',
  prompt:
    'This is the side panel of one protein. From its header area (above the tabs): the accession, the sequence coverage in percent ' +
    'as written in the header badge (a number, null if the header shows none), and the numbers of peptides and of PSMs it states. ' +
    'Say whether a coverage map or coverage strip of the sequence is visible, and whether any text is clipped or overlapping (list it); ' +
    'rows cut off at the bottom edge of the scrolling sequence map do not count.',
  schema: object({
    accession: str,
    coverage_percent_in_header: numOrNull,
    peptides_in_header: numOrNull,
    psms_in_header: numOrNull,
    coverage_map_visible: bool,
    text_clipped_or_overlapping: bool,
    clipped_or_overlapping_items: list,
  }),
}

export interface FiguresAnswer {
  protein_groups: number | null
  peptides: number | null
  psms: number | null
  percent_of_ms2: number | null
  median_precursor_error_ppm: number | null
  psm_fdr_percent_stated: number | null
  text_clipped_or_overlapping: boolean
  clipped_or_overlapping_items: string[]
}

export const KEY_FIGURES: Question = {
  name: 'key-figures',
  prompt:
    'This is the strip of key figures above a results table. Read the large numbers: protein groups, peptides, PSMs, the percentage ' +
    'of MS2 spectra stated under the PSMs, the median precursor error in ppm, and the PSM FDR in percent stated in the notes ' +
    '(null for anything not shown). Say whether any text is clipped or overlapping (list it).',
  schema: object({
    protein_groups: numOrNull,
    peptides: numOrNull,
    psms: numOrNull,
    percent_of_ms2: numOrNull,
    median_precursor_error_ppm: numOrNull,
    psm_fdr_percent_stated: numOrNull,
    text_clipped_or_overlapping: bool,
    clipped_or_overlapping_items: list,
  }),
}
