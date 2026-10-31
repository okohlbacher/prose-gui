<script lang="ts">
  // Help › Reading the results: the Overview and its cards (which appear only when something needs attention), the
  // tables, the spectrum, QC and the export; ids "results-…" and "help-groups" (linked from the protein panel).
  import { openHelp } from '$lib/help-link.svelte'
</script>

<section id="results-overview" aria-labelledby="results-overview-h">
  <h2 id="results-overview-h">Reading the Overview</h2>
  <p>
    Above the tabs, the key figures say what the search found at its own cutoffs: protein groups, peptides, PSMs (each with
    the FDR that controls it), samples and the median precursor error. Export, at the top right, is described below.
  </p>
  <p>
    Overview shows what was searched and how (Search), and the files (Files): for each its MS2 spectra, target and decoy
    PSMs, whether Percolator rescored it (and if not, why), and its status. Marks under a file name say what limited its search
    (no MS2 spectra, profile spectra, spectra not searched because of their charge); “no FDR” under its PSMs says its PSM FDR was
    not applied. The sections below the files, and the notices in them, say what needs attention; each notice names its
    evidence, offers a re-run where one helps, and links to what to do. A notice that the protein FDR was not applied, and the
    “Why so few identifications?” card, appear at the top, and only when they apply.
  </p>
  <ul class="prose-list">
    <li><b>Why so few identifications?</b> A file identifies a smaller share of its MS2 spectra than a search of its kind usually does, or far fewer than the rest of the batch; the likely causes the search reports, strongest first.</li>
    <li><b>Mass accuracy:</b> the precursor and fragment errors of the passing PSMs per file, with the recommended windows, and notices when the errors are off-centre, cut off by the window, or need much less than it. The precursor notices judge the errors of all files together, from 30 passing PSMs on; the fragment notices judge each file, and only for a ppm window.</li>
    <li><b>Checks of the search:</b> the notices New search showed before the search, and what can go wrong silently (an input without a run, spectra counted twice, decoys not recognised or too few of them, all q-values 0, precursors on an isotope peak, retention times in the wrong unit), and under “What ProSE used” the settings as ProSE recorded them beside those you set.</li>
    <li><b>Sample chemistry:</b> the share of peptides with a cysteine against the share expected from the proteins, missed cleavages and non-specific ends (and, for a TMT or iTRAQ label searched as variable, its share on K): signs that the alkylation, enzyme or label of the search do not match the sample.</li>
  </ul>
  <p>
    Always there, below them: the <b>Methods text</b>, the search described for a paper (“Copy”), and “Copy command line”, ProSE’s
    command as the app ran it. After it, for an open search, <b>Mass shifts</b>: the frequent mass differences; a shift is a mass
    difference, not an identified modification.
  </p>
  <p>
    No card does not mean the search is right: the cards catch what the search can see. <button type="button" class="jump" onclick={() => openHelp('troubleshooting')}>Troubleshooting</button> says what to do about each.
  </p>
</section>

<section id="results" aria-labelledby="results-h">
  <h2 id="results-h">The tables and views</h2>
  <ul class="prose-list">
    <li id="help-groups"><b>Protein groups:</b> a peptide can occur in several proteins. Proteins that share all their identified peptides cannot be told apart and form one group; the evidence for a group is not unique evidence for each protein or isoform in it.</li>
    <li><b>Proteins, Peptides, PSMs:</b> click a row to go deeper: a protein opens its coverage and peptides, a peptide its PSMs, a PSM its spectrum. Accessions are links to their protein. Each table has one filter row: text, a q-value cutoff (it can only tighten the search’s), on Proteins the minimum number of peptides and “found in”, and a menu with “Hide contaminants”, “Show decoys” and filters by range or SDRF value. Contaminants and decoys are hidden by default.</li>
    <li>
      <b>Counts:</b> a protein’s peptide count combines the modified forms of one sequence, while the Peptides table lists each
      form as its own row. A PSM of a peptide shared by several proteins counts for each of them. The per-sample columns count
      PSMs, not protein abundance. Leucine and isoleucine have the same mass, so a search cannot tell them apart.
    </li>
    <li><b>Spectrum:</b> measured peaks above, predicted (PeptDeep) or theoretical ions below. Drag across it to zoom, double-click to zoom out. Hovering an ion in the table marks its peak.</li>
    <li><b>Samples:</b> the design of the search (and its SDRF): which file belongs to which sample, fraction and replicate.</li>
    <li><b>QC:</b> the scores, the precursor mass errors, the identifications by q-value cutoff (how many target PSMs and peptides each cutoff up to the search’s FDR keeps) and the PSMs per file. The charts show only PSMs that passed the FDR, so the score chart is not a full target-decoy separation plot.</li>
    <li><b>Modification positions</b> are where the search placed them, not localized with a site score.</li>
    <li>
      <b>Export</b> (top right): CSV or Excel of the table you see; the spectrum shown as SVG; the identifications as idXML for other
      OpenMS tools; the design (design.tsv) and an SDRF with the search’s settings for a quantification workflow; or a results archive
      (.prose) for colleagues. A results archive holds the
      results and the search record, the sequences of the proteins in the results and the spectra of its PSMs, not the spectrum
      files, the full searched FASTA or the log: to repeat the search, they need those too. To set the same search up again, save a project (File › Save
      Project: the setup, not the results; Help › File formats).
    </li>
  </ul>
</section>
