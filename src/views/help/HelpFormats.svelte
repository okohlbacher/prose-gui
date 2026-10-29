<script lang="ts">
  // Help › File formats: what the app reads (spectra, databases, designs, results of ProSE run elsewhere), what a
  // search writes into its folder, and what the exports hold. Kept to what the app actually does
  // (src/lib/search/files.ts, src-tauri/src/args.rs, project.rs).
</script>

<section id="formats" aria-labelledby="formats-h">
  <h2 id="formats-h">File formats</h2>
  <p>
    Everything goes in through one <b>Add files</b> button (or by dropping files on the window): spectra, a FASTA database and
    an SDRF or design.tsv, together or one after the other. The app reads the files where they are; it never copies or
    changes them.
  </p>

  <h3 id="formats-spectra">Spectra</h3>
  <table class="formats">
    <thead><tr><th>Format</th><th>Files</th><th>Notes</th></tr></thead>
    <tbody>
      <tr>
        <td>mzML</td><td><code>.mzML</code>, <code>.mzML.gz</code></td>
        <td>The open standard; from any vendor through ProteoWizard msconvert. Centroid the MS2 spectra when you convert
          (msconvert's <code>peakPicking</code> filter, vendor algorithm, MS levels 1-); profile spectra find far fewer
          peptides. New search checks mzML files before the search (peak picking, charges, activation, isolation windows).</td>
      </tr>
      <tr>
        <td>Thermo raw</td><td><code>.raw</code></td>
        <td>Read directly (Orbitrap, Astral, ion trap), no conversion needed. Waters files, also called <code>.raw</code>, are
          folders and are not read: convert them to mzML. Raw files are checked only after the search.</td>
      </tr>
      <tr>
        <td>Bruker timsTOF</td><td><code>.d</code> folder</td>
        <td>timsTOF data (<code>analysis.tdf</code> inside). Drop the folder, or choose its <code>analysis.tdf</code> in the
          Add files dialog. Other Bruker <code>.d</code> folders (without <code>analysis.tdf</code>) and Agilent <code>.d</code>
          folders are not read: convert them to mzML.</td>
      </tr>
      <tr>
        <td>mzPeak</td><td><code>.mzpeak</code></td>
        <td>The Parquet-based successor of mzML (HUPO-PSI, in development): compact and fast to read.</td>
      </tr>
      <tr>
        <td>Not read</td><td><code>.wiff</code>, <code>.mgf</code>, <code>.mzXML</code>, …</td>
        <td>SCIEX, MGF peak lists and older formats: convert them to mzML with msconvert. DIA data can be read but is not
          what ProSE searches: it is a DDA search engine.</td>
      </tr>
    </tbody>
  </table>

  <h3 id="formats-database">Protein database</h3>
  <p>
    A <b>FASTA</b> file (<code>.fasta</code>, <code>.fa</code>, <code>.faa</code>): one entry per protein, a header line
    starting with <code>&gt;</code>, then its sequence. UniProt headers (<code>&gt;sp|P02768|ALBU_HUMAN … OS=Homo sapiens
    OX=9606 GN=ALB</code>) give the tables their accessions, gene names and organisms. A FASTA that already has decoys
    (reversed or shuffled entries with a prefix such as <code>DECOY_</code> or <code>rev_</code>) is recognised; otherwise
    ProSE makes its own. Proteomes downloaded from UniProt in the database card are saved as <code>UP…fasta</code> in the
    <code>databases</code> folder of the app's data folder and shown with their organism.
  </p>

  <h3 id="formats-design">Experimental design</h3>
  <ul>
    <li>
      <b>SDRF</b> (<code>.sdrf.tsv</code>, Sample and Data Relationship Format of SDRF-Proteomics): one row per sample and data
      file, with the organism, instrument, labels, enzyme, modifications and the factors of the experiment. It is the format
      PRIDE uses. The app adds the files it names (and can download missing ones from PRIDE), fills the design table from it,
      and checks its modifications, labels and organism against the search. <b>Metadata…</b> in its panel shows what it
      says.
    </li>
    <li><b>design.tsv</b>: OpenMS's experimental design (files with fraction group, fraction, sample, condition). Its fields fill the design table.</li>
  </ul>

  <h3 id="formats-results">What a search writes</h3>
  <p>Each search gets a folder in the app's data folder (History). The files that matter:</p>
  <table class="formats">
    <thead><tr><th>File</th><th>What it holds</th></tr></thead>
    <tbody>
      <tr><td><code>qpx/</code></td><td>The results in QPX (quantms Parquet): PSMs, protein groups, runs, samples and the provenance with every parameter; <code>runs/</code> per input, with the spectra of the PSMs. The Results view reads these.</td></tr>
      <tr><td><code>search.idXML</code>, <code>merged.idXML</code></td><td>The identifications in OpenMS's idXML, for other OpenMS tools (Export › idXML).</td></tr>
      <tr><td><code>prose.ini</code>, <code>command.txt</code></td><td>ProSE's parameters as it was given them, and its command line: to repeat the search outside the app.</td></tr>
      <tr><td><code>search.json</code>, <code>inputs.json</code></td><td>The app's record of the search (name, settings, design) and where its files were.</td></tr>
      <tr><td><code>proteins.fasta</code></td><td>The sequences of the identified proteins, so that the search opens without its database.</td></tr>
      <tr><td><code>design.sdrf.tsv</code></td><td>The SDRF as ProSE was given it, when the search had one.</td></tr>
      <tr><td><code>mods/</code></td><td>An open search's mass-shift tables.</td></tr>
      <tr><td><code>prose.log</code></td><td>ProSE's log.</td></tr>
    </tbody>
  </table>
  <p>
    <b>Open QPX folder…</b> in History opens the QPX output of a ProSE run outside the app (for example on a cluster:
    <code>ProSE -in … -database … -out_qpx &lt;folder&gt; -qpx_extended -keep_decoys</code>).
  </p>

  <h3 id="formats-exports">Exports</h3>
  <ul>
    <li><b>CSV</b> and <b>Excel (.xlsx)</b>: the table you see, with its filters and columns (peptides in ProForma).</li>
    <li><b>design.tsv</b> and <b>SDRF</b>: the design of the search.</li>
    <li><b>Spectrum (SVG)</b>: the annotated spectrum as a vector drawing.</li>
    <li><b>idXML</b>: the identifications for OpenMS.</li>
    <li>
      <b>Project (.prose)</b>: a search as one zip, to open in ProSE on another computer. It holds the results and the
      record, not the spectra, the database copy or the log, and it names folders of the computer that searched.
    </li>
  </ul>
</section>
