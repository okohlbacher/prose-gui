<script lang="ts">
  // Help › How a search works: fragmentation into b and y ions (animated), the pipeline from the FASTA and the
  // spectra to scored matches, matching candidates against a spectrum (animated), and rescoring.
  import FragmentationAnimation from '$lib/components/help/FragmentationAnimation.svelte'
  import MatchingAnimation from '$lib/components/help/MatchingAnimation.svelte'

  const b = 'var(--color-blue-600, #2563eb)'
  const y = 'var(--color-orange-500, #f97316)'
</script>

<section id="how" aria-labelledby="how-h">
  <h2 id="how-h">How a database search works</h2>
  <p>
    In bottom-up proteomics, proteins are cut into peptides by an enzyme (usually trypsin). The mass spectrometer measures
    the mass-to-charge ratio (m/z) of each peptide ion (the <em>precursor</em>, in the MS1 scan; with its charge this gives the
    peptide's mass), then breaks it apart and measures the m/z of the pieces (the <em>fragments</em>, in the MS2 spectrum). In
    the usual CID/HCD fragmentation a peptide breaks mostly along its backbone, so its fragments form two ladders:
    <b style:color={b}>b ions</b> carry the start (N-terminus) of the sequence, <b style:color={y}>y ions</b> the end
    (C-terminus). For singly charged fragments, neighbouring rungs of one ladder differ by the mass of one amino-acid residue (with any
    modification on it); for fragments of charge z, the m/z spacing is that mass divided by z.
    Not every rung is observed in a real spectrum.
  </p>

  <FragmentationAnimation />

  <p>
    A <em>database search</em> turns this around. ProSE digests every protein of the FASTA file in the computer, the same way the
    enzyme did, and computes the fragment masses of every peptide. For each measured spectrum it takes the peptides whose
    mass fits the precursor (within the <em>precursor tolerance</em>), counts how many of their predicted fragments are
    found among the measured peaks (within the <em>fragment tolerance</em>), and scores the agreement. The best-scoring
    peptide is the spectrum's <em>peptide-spectrum match</em> (PSM). It is a candidate: with FDR control on, it is reported only if it
    passes the FDR cutoff (see Decoys and the FDR).
  </p>

  <figure>
    <svg viewBox="0 0 700 170" role="img" aria-labelledby="fig2">
      <title id="fig2">From the FASTA and the spectra to scored matches</title>
      <g class="step"><rect x="10" y="20" width="150" height="54" rx="10" /><text x="85" y="44" text-anchor="middle">Protein database</text><text x="85" y="62" text-anchor="middle" class="sub">FASTA + decoys</text></g>
      <g class="step"><rect x="10" y="100" width="150" height="54" rx="10" /><text x="85" y="124" text-anchor="middle">MS2 spectra</text><text x="85" y="142" text-anchor="middle" class="sub">mzML, .raw, .d, mzPeak</text></g>
      <g class="step"><rect x="210" y="20" width="150" height="54" rx="10" /><text x="285" y="44" text-anchor="middle">In-silico digest</text><text x="285" y="62" text-anchor="middle" class="sub">peptides → fragments</text></g>
      <g class="step"><rect x="410" y="55" width="130" height="64" rx="10" /><text x="475" y="82" text-anchor="middle">Match and score</text><text x="475" y="100" text-anchor="middle" class="sub">within tolerances</text></g>
      <g class="step hl"><rect x="580" y="55" width="110" height="64" rx="10" /><text x="635" y="82" text-anchor="middle">Best PSM</text><text x="635" y="100" text-anchor="middle" class="sub">per spectrum</text></g>
      <path d="M160 47 h46" class="arrow" /><path d="M360 47 C385 47 385 75 406 80" class="arrow" />
      <path d="M160 127 C300 127 380 105 406 96" class="arrow" /><path d="M540 87 h36" class="arrow" />
    </svg>
    <figcaption>ProSE compares each measured spectrum with the predicted fragments of the peptides whose mass fits. The spectra can be mzML, mzPeak, Thermo .raw or Bruker timsTOF .d files.</figcaption>
  </figure>

  <MatchingAnimation />

  <p>
    Explaining more measured peaks, above all intense ones, gives a higher score. The Results view shows every PSM this way:
    measured peaks above, the predicted ions of its peptide below.
  </p>
  <p>
    With rescoring on (the Percolator switch under Rescoring, step 4 of New search), ProSE then rescores the matches with <em>Percolator</em>: a learned
    combination of many features (score, mass error, charge, number of matched ions and, with PeptDeep, how well predicted
    fragment intensities and retention times agree). Percolator is part of ProSE. When a file has too few confident matches to
    learn from, Percolator falls back to a single score; Overview › Files › Percolator says so, and why. From the peptides ProSE
    infers the proteins, and finally it estimates how many of the results are wrong.
  </p>
  <h3 id="basics-menus">The app's menus</h3>
  <p>
    The desktop app has the usual menus: in the menu bar on macOS, at the top of the window on Windows and Linux (with
    Ctrl in place of ⌘; About is under Help, Exit under File there).
  </p>
  <ul>
    <li><b>File</b>: New Search (⌘N: an empty setup, not part of the project you had open; Undo under the file list brings the files back, and unsaved changes to the project are asked about first); Open Project (⌘O), Open Recent, Save Project (⌘S), Save Project As (⇧⌘S); Open QPX Folder; Import Results Archive (.prose); Export (CSV, Excel, idXML, Results archive) with a result open; Close Window (⌘W).</li>
    <li><b>Edit</b>: Undo, Redo, Cut, Copy, Paste and Select All, for the text fields.</li>
    <li><b>View</b>: New Search, Results, History and Help (⇧⌘1 to ⇧⌘4); Theme (System, Light, Dark); full screen.</li>
    <li><b>Window</b>: Minimize and Zoom. <b>Help</b>: this Help, Troubleshooting, Keyboard Shortcuts (⌘/), the ProSE web app, and Report an Issue (GitHub, in your browser).</li>
  </ul>
  <p>Closing the window while a search runs asks first, from the menu as from the window's close button.</p>
</section>
