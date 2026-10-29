<script lang="ts">
  // Help › Reading the results: the Overview and its cards (which appear only when something needs attention), the
  // tables, the spectrum, QC and the export; ids "results-…" and "help-groups" (linked from the protein panel).
  import { openHelp } from '$lib/help-link.svelte'
</script>

<section id="results-overview" aria-labelledby="results-overview-h">
  <h2 id="results-overview-h">Reading the Overview</h2>
  <p>
    Overview starts with what was searched and how (Search), and the files (Files): for each its MS2 spectra, target and decoy
    PSMs, whether Percolator rescored it (and if not, why), and its status. Marks under a file name say what limited its search
    (no MS2 spectra, profile spectra, spectra not searched because of their charge); “no FDR” under its PSMs says its PSM FDR was
    not applied. Below come cards that appear only when something needs attention; each names its evidence, offers a re-run
    where one helps, and links to what to do.
  </p>
  <ul class="prose-list">
    <li><b>Why so few identifications?</b> A file identifies a smaller share of its MS2 spectra than a search of its kind usually does, or far fewer than the rest of the batch; the likely causes the search reports, strongest first.</li>
    <li><b>Mass accuracy:</b> the precursor and fragment errors of the passing PSMs, with the searched and the recommended windows, and whether the errors are off-centre, cut off by the window, or need much less than it.</li>
    <li><b>Sample chemistry:</b> the share of peptides with a cysteine against the share expected from the proteins, missed cleavages and non-specific ends (and, for a TMT or iTRAQ label searched as variable, its share on K): signs that the alkylation, enzyme or label of the search do not match the sample.</li>
    <li><b>Checks of the search:</b> what can go wrong silently (an input without a run, spectra counted twice, decoys not recognised, precursors on an isotope peak, retention times in the wrong unit), and under “What ProSE used” the settings as ProSE recorded them beside those you set.</li>
    <li><b>Mass shifts (open search):</b> the frequent mass differences of an open search; a shift is a mass difference, not an identified modification.</li>
  </ul>
  <p>
    Always there, at the end: the <b>Methods text</b>, the search described for a paper, and “Copy command line”, ProSE’s command as
    the app ran it.
  </p>
  <p>
    No card does not mean the search is right: the cards catch what the search can see. <button type="button" class="jump" onclick={() => openHelp('troubleshooting')}>Troubleshooting</button> says what to do about each.
  </p>
</section>

<section id="results" aria-labelledby="results-h">
  <h2 id="results-h">The tables and views</h2>
  <ul class="prose-list">
    <li id="help-groups"><b>Protein groups:</b> a peptide can occur in several proteins. Proteins that share all their identified peptides cannot be told apart and form one group; the evidence for a group is not unique evidence for each protein or isoform in it.</li>
    <li><b>Proteins, Peptides, PSMs:</b> click a row to go deeper: a protein opens its coverage and peptides, a peptide its PSMs, a PSM its spectrum. Accessions are links to their protein. Contaminants and decoys are hidden by default (the filter menu shows them).</li>
    <li>
      <b>Counts:</b> a protein’s peptide count combines the modified forms of one sequence, while the Peptides table lists each
      form as its own row. A PSM of a peptide shared by several proteins counts for each of them. The per-sample columns count
      PSMs, not protein abundance. Leucine and isoleucine have the same mass, so a search cannot tell them apart.
    </li>
    <li><b>Spectrum:</b> measured peaks above, predicted (PeptDeep) or theoretical ions below. Drag across it to zoom, double-click to zoom out. Hovering an ion in the table marks its peak.</li>
    <li><b>Samples:</b> the design of the search (and its SDRF): which file belongs to which sample, fraction and replicate.</li>
    <li><b>QC:</b> the scores, mass errors and PSMs per file. The score chart shows only PSMs that passed the FDR, so it is not a full target-decoy separation plot.</li>
    <li><b>Modification positions</b> are where the search placed them, not localized with a site score.</li>
    <li>
      <b>Export:</b> CSV or Excel of the table you see; the identifications as idXML for other OpenMS tools; the design (design.tsv)
      and an SDRF with the search’s settings for a quantification workflow; or a .prose project for colleagues. A project holds the
      results and the search record, and the sequences of the proteins in the results, not the spectra, the full searched FASTA or
      the log: to repeat the search, they need those too.
    </li>
  </ul>
</section>
