<script lang="ts">
  // Help: how a database search works (with drawings), what the main settings mean, how to read the results,
  // and where to learn more (videos, the ProSE web app and code). Links open in the system's browser.
  import { openUrl } from '$lib/desktop'
  import { helpTarget } from '$lib/help-link.svelte'
  import { tick } from 'svelte'
  import { HELP, type HelpKey } from '$lib/settings/help'

  // opened at a section from elsewhere in the app (a "More in Help" link)
  $effect(() => {
    const id = helpTarget.id
    if (id === null) return
    helpTarget.id = null
    void tick().then(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }))
  })

  const link = (url: string) => (e: MouseEvent) => {
    e.preventDefault()
    void openUrl(url)
  }

  const settings: HelpKey[] = [
    'setup',
    'database',
    'contaminants',
    'decoys',
    'variableMods',
    'fixedMods',
    'psmFdr',
    'proteinFdr',
    'enzyme',
    'missedCleavages',
    'precursorTolerance',
    'fragmentTolerance',
    'charges',
    'length',
  ]

  const videos = [
    { id: 'wx4F6kGy1Fs', title: 'MS-based proteomics: a short introduction to the core concepts', by: 'Lars Juhl Jensen' },
    { id: 'L6MHSb7I820', title: 'Mass spectrometry for proteomics, part 2 (fragmentation, MS/MS)', by: 'Matt Padula' },
    { id: 'Esf1EqzyQZc', title: 'Searching databases for protein identification, part 1', by: 'Matt Padula' },
    { id: 'tB3cR2vDCKc', title: 'Introduction to database searching using Mascot', by: 'Matrix Science' },
    { id: 'fBT6vuBCdLg', title: 'A blue-collar explanation of the target-decoy approach to FDR', by: 'LMS Research Group' },
    { id: 'L3nlGfSyHV0', title: 'False discovery rates, FDR, clearly explained (statistics)', by: 'StatQuest' },
    { id: 'MlQ3Foge9UM', title: 'FDR estimation and protein identification (May Institute 2018)', by: 'Oliver Kohlbacher' },
    { id: 'JGHdaWdojxU', title: 'Protein identification: a deeper dive into MS-based proteomics data', by: 'Lars Juhl Jensen' },
  ]

  const resources = [
    { url: 'https://timosachsenberg.github.io/prose-web/', title: 'ProSE web app', note: 'ProSE in the browser, on your own data, nothing uploaded' },
    { url: 'https://github.com/timosachsenberg/prose-gui', title: 'ProSE desktop app (source)', note: 'this app; issues and releases' },
    { url: 'https://github.com/OpenMS/OpenMS/pull/10740', title: 'ProSE in OpenMS', note: 'the search engine itself (pull request #10740)' },
    { url: 'https://openms.readthedocs.io/', title: 'OpenMS documentation', note: 'the toolkit ProSE is part of' },
    { url: 'https://www.uniprot.org/proteomes', title: 'UniProt proteomes', note: 'reference proteomes (FASTA) for any organism' },
    { url: 'https://www.thegpm.org/crap/', title: 'cRAP', note: 'the common contaminants ProSE can add' },
  ]

  // the drawings use the theme's colours; b ions blue, y ions orange, as in the spectrum view
  const b = 'var(--color-blue-600, #2563eb)'
  const y = 'var(--color-orange-500, #f97316)'
</script>

<article class="help mx-auto flex max-w-[860px] flex-col gap-8 pb-10 text-[13.5px] leading-relaxed" data-testid="view-help">
  <header>
    <h1 class="mb-1 text-xl font-semibold tracking-tight">Help</h1>
    <p class="text-muted-foreground">
      How ProSE finds peptides and proteins in your spectra, what the settings mean, and how far to trust the results.
    </p>
    <nav class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="On this page">
      <!-- (buttons, not #anchors: the hash is the app's route) -->
      {#each [['how', 'How a search works'], ['fdr', 'Decoys and the FDR'], ['settings', 'The settings'], ['results', 'Reading the results'], ['learn', 'Videos and links']] as [id, label] (id)}
        <button type="button" class="jump" onclick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })}>{label}</button>
      {/each}
    </nav>
  </header>

  <section id="how" aria-labelledby="how-h">
    <h2 id="how-h">How a database search works</h2>
    <p>
      In bottom-up proteomics, proteins are cut into peptides by an enzyme (usually trypsin). The mass spectrometer measures
      the mass-to-charge ratio (m/z) of each peptide ion (the <em>precursor</em>, in the MS1 scan; with its charge this gives the
      peptide's mass), then breaks it apart and measures the m/z of the pieces (the <em>fragments</em>, in the MS2 spectrum). In
      the usual CID/HCD fragmentation a peptide breaks mostly along its backbone, so its fragments form two ladders:
      <b style:color={b}>b ions</b> carry the start (N-terminus) of the sequence, <b style:color={y}>y ions</b> the end
      (C-terminus). Neighbouring rungs of one ladder differ by the mass of one amino-acid residue (with any modification on it).
      Not every rung is observed in a real spectrum.
    </p>

    <!-- 1. fragmentation into b and y ions -->
    <figure>
      <svg viewBox="0 0 640 150" role="img" aria-labelledby="fig1">
        <title id="fig1">The peptide PEPTIDEK breaks between residues; b ions keep the start, y ions the end</title>
        {#each ['P', 'E', 'P', 'T', 'I', 'D', 'E', 'K'] as aa, i (i)}
          <rect x={60 + i * 66} y="55" width="46" height="40" rx="8" class="box" />
          <text x={83 + i * 66} y="81" text-anchor="middle" class="aa">{aa}</text>
          {#if i < 7}
            <line x1={116 + i * 66} x2={116 + i * 66} y1="40" y2="110" class="cut" />
            <text x={116 + i * 66} y="32" text-anchor="middle" font-size="11" fill={b}>b{i + 1}</text>
            <text x={116 + i * 66} y="128" text-anchor="middle" font-size="11" fill={y}>y{7 - i}</text>
          {/if}
        {/each}
        <path d="M60 20 h56" stroke={b} stroke-width="3" marker-end="url(#ab)" />
        <path d="M578 142 h-56" stroke={y} stroke-width="3" marker-end="url(#ay)" />
        <defs>
          <marker id="ab" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L10 5 L0 10z" fill={b} /></marker>
          <marker id="ay" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L10 5 L0 10z" fill={y} /></marker>
        </defs>
      </svg>
      <figcaption>A peptide breaks between its residues. A break can give a b ion (the part with the start) and a y ion (the part with the end); often only one of them is seen.</figcaption>
    </figure>

    <p>
      A <em>database search</em> turns this around. ProSE digests every protein of the FASTA file in the computer, the same way the
      enzyme did, and computes the fragment masses of every peptide. For each measured spectrum it takes the peptides whose
      mass fits the precursor (within the <em>precursor tolerance</em>), counts how many of their predicted fragments are
      found among the measured peaks (within the <em>fragment tolerance</em>), and scores the agreement. The best-scoring
      peptide is the spectrum's <em>peptide-spectrum match</em> (PSM).
    </p>

    <!-- 2. the pipeline -->
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
      <figcaption>ProSE compares each measured spectrum with the predicted fragments of the peptides whose mass fits.</figcaption>
    </figure>

    <!-- 3. a match: observed peaks vs predicted ions -->
    <figure>
      <svg viewBox="0 0 640 170" role="img" aria-labelledby="fig3">
        <title id="fig3">A match: measured peaks above the line, the predicted b and y ions below; peaks that line up count</title>
        <line x1="30" x2="610" y1="85" y2="85" class="axis" />
        {#each [[70, 30, 'u'], [110, 52, 'b'], [150, 18, 'u'], [200, 64, 'y'], [250, 40, 'b'], [300, 22, 'u'], [340, 70, 'y'], [390, 35, 'b'], [440, 15, 'u'], [480, 56, 'y'], [530, 28, 'y'], [575, 12, 'u']] as [x, h, kind], i (i)}
          <line x1={x} x2={x} y1="85" y2={85 - Number(h)} stroke-width="4" stroke-linecap="round" stroke={kind === 'b' ? b : kind === 'y' ? y : 'var(--color-muted-foreground)'} opacity={kind === 'u' ? 0.45 : 1} />
        {/each}
        {#each [[110, 'b'], [200, 'y'], [250, 'b'], [340, 'y'], [390, 'b'], [480, 'y'], [530, 'y'], [610 - 40, 'b']] as [x, kind], i (i)}
          <line x1={x} x2={x} y1="85" y2="135" stroke-width="4" stroke-linecap="round" stroke={kind === 'b' ? b : y} opacity="0.5" />
        {/each}
        <text x="30" y="18" class="sub">measured spectrum</text>
        <text x="30" y="160" class="sub">theoretical b and y ion positions (m/z) of the candidate peptide</text>
      </svg>
      <figcaption>
        Coloured peaks match the candidate's b and y ions within the fragment tolerance; grey peaks are unassigned (other fragment
        types, other peptides or noise). Explaining more measured peaks, above all intense ones, gives a higher score. The Results
        view shows every PSM this way.
      </figcaption>
    </figure>
    <p>
      With rescoring on (and Percolator installed), ProSE then rescores the matches with <em>Percolator</em>: a learned combination
      of many features (score, mass error, charge, number of matched ions and, with PeptDeep, how well predicted fragment
      intensities and retention times agree). From the peptides it infers the proteins, and finally it estimates how many of the
      results are wrong.
    </p>
  </section>

  <section id="fdr" aria-labelledby="fdr-h">
    <h2 id="fdr-h">Decoys and the false discovery rate</h2>
    <p>
      Every spectrum gets a best match, even a spectrum of noise or of a peptide that is not in the database. To tell how many
      of the matches are wrong, ProSE also searches <em>decoys</em>: artificial sequences (the proteins reversed or shuffled) built to
      model wrong matches. The method assumes that a wrong match is about as likely to land on a decoy as on a real (target)
      sequence, so the decoys above a score cutoff estimate the wrong targets above it.
    </p>
    <figure>
      <svg viewBox="0 0 640 190" role="img" aria-labelledby="fig4">
        <title id="fig4">Scores of target and decoy matches; above the cutoff, decoys divided by targets estimates the FDR</title>
        <path d="M40 160 C120 160 150 60 210 60 C270 60 310 140 370 152 C410 158 440 160 470 160 Z" fill={y} opacity="0.35" />
        <text x="420" y="150" text-anchor="middle" font-size="10" fill={y}>decoys above the cutoff</text>
        <path d="M40 160 C140 160 170 70 230 70 C290 70 320 150 360 140 C420 120 440 30 500 30 C560 30 580 160 610 160 Z" fill={b} opacity="0.35" />
        <line x1="40" x2="620" y1="160" y2="160" class="axis" />
        <line x1="370" x2="370" y1="20" y2="165" class="cut" />
        <text x="378" y="30" class="sub">score cutoff</text>
        <text x="210" y="52" text-anchor="middle" font-size="11" fill={y}>decoys (wrong)</text>
        <text x="500" y="22" text-anchor="middle" font-size="11" fill={b}>targets (right + some wrong)</text>
        <text x="40" y="182" class="sub">low score</text><text x="620" y="182" text-anchor="end" class="sub">high score</text>
      </svg>
      <figcaption>FDR above the cutoff ≈ decoy matches ÷ target matches above it. ProSE chooses the cutoff that gives the FDR you set (e.g. 1 %).</figcaption>
    </figure>
    <ul>
      <li>The <b>PSM FDR</b> controls the matches: at 1 %, about one in a hundred reported PSMs is expected to be wrong. It is an estimate for the whole list, not a property of a single PSM.</li>
      <li>Each PSM has a <b>q-value</b>: the lowest FDR at which it would still be reported.</li>
      <li>
        The <b>protein FDR</b> is estimated separately. Wrong PSMs scatter over many proteins, so a protein list filtered at 1 % PSM FDR
        can contain far more than 1 % wrong proteins. Keep the protein FDR on for protein lists. When it is off, the app says so.
      </li>
      <li>Counts of peptides are not FDR-controlled at the peptide level; they come from the PSMs at the PSM FDR.</li>
      <li>
        Only PSMs that pass the search's PSM FDR are kept. A stricter cutoff in the results filters them further; to see matches
        below the original cutoff, search again with a higher FDR.
      </li>
    </ul>
  </section>

  <section id="settings" aria-labelledby="settings-h">
    <h2 id="settings-h">The settings</h2>
    <p>
      Start with the <b>setup</b> of your instrument, the <b>database</b> of your organism and the <b>variable modifications</b> of your
      sample preparation. The instrument-dependent rest comes from the setup and is under “Advanced settings”, but the built-in
      setups assume a tryptic digest and alkylated cysteines: check the enzyme and the fixed modifications against your protocol.
      The same explanations are behind the <span aria-hidden="true">?</span> beside each setting.
    </p>
    <dl class="settings">
      {#each settings as key (key)}
        <div id="help-{key}">
          <dt>{HELP[key].title}</dt>
          <dd>{HELP[key].text}{#if 'tip' in HELP[key]}<span class="tip"> {HELP[key].tip}</span>{/if}</dd>
        </div>
      {/each}
    </dl>
  </section>

  <section id="results" aria-labelledby="results-h">
    <h2 id="results-h">Reading the results</h2>
    <ul>
      <li><b>Overview:</b> what was searched, the files, and the observed precursor and fragment mass errors with recommended tolerances for the next search. Its methods text can be copied into a paper.</li>
      <li id="help-groups"><b>Protein groups:</b> a peptide can occur in several proteins. Proteins that share all their identified peptides cannot be told apart and form one group; the evidence for a group is not unique evidence for each protein or isoform in it.</li>
      <li><b>Proteins, Peptides, PSMs:</b> click a row to go deeper: a protein opens its coverage and peptides, a peptide its PSMs, a PSM its spectrum. Accessions are links to their protein.</li>
      <li><b>Spectrum:</b> measured peaks above, predicted (PeptDeep) or theoretical ions below. Drag across it to zoom, double-click to zoom out. Hovering an ion in the table marks its peak.</li>
      <li><b>QC:</b> the scores, mass errors and PSMs per file. The score chart shows only PSMs that passed the FDR, so it is not a full target-decoy separation plot.</li>
      <li><b>Modification positions</b> are where the search placed them, not localized with a site score. An open-search mass shift is a mass difference, not an identified modification.</li>
      <li><b>Export:</b> CSV or Excel of the table you see, the idXML for other OpenMS tools, or a .prose project for colleagues.</li>
    </ul>
  </section>

  <section id="learn" aria-labelledby="learn-h">
    <h2 id="learn-h">Videos and links</h2>
    <p class="text-muted-foreground">These open in your browser. The videos are by others, chosen as introductions; ProSE is not affiliated with them.</p>
    <h3>Videos</h3>
    <ul class="links">
      {#each videos as v (v.id)}
        <li><a href="https://www.youtube.com/watch?v={v.id}" onclick={link(`https://www.youtube.com/watch?v=${v.id}`)}>{v.title}</a> <span class="text-muted-foreground">· {v.by}</span></li>
      {/each}
    </ul>
    <h3>ProSE and resources</h3>
    <ul class="links">
      {#each resources as r (r.url)}
        <li><a href={r.url} onclick={link(r.url)}>{r.title}</a> <span class="text-muted-foreground">· {r.note}</span></li>
      {/each}
    </ul>
  </section>
</article>

<style>
  .help h2 {
    margin-bottom: 0.5rem;
    font-size: 15px;
    font-weight: 600;
    scroll-margin-top: 1rem;
  }
  .help h3 {
    margin: 0.75rem 0 0.25rem;
    font-size: 13px;
    font-weight: 600;
  }
  .help section > :global(* + p),
  .help section > :global(* + ul) {
    margin-top: 0.6rem;
  }
  .help .jump {
    color: var(--color-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .help ul {
    list-style: disc;
    padding-left: 1.25rem;
  }
  .help ul li + li {
    margin-top: 0.3rem;
  }
  .help a {
    color: var(--color-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .help figure {
    margin: 1rem 0;
    border: 1px solid var(--color-border);
    border-radius: 0.6rem;
    background: var(--color-background);
    padding: 0.75rem 1rem;
  }
  .help figcaption {
    margin-top: 0.4rem;
    font-size: 12px;
    color: var(--color-muted-foreground);
  }
  .help svg {
    width: 100%;
    height: auto;
    font-family: inherit;
    font-size: 12px;
  }
  .help svg text {
    fill: var(--color-foreground);
  }
  .help svg .sub {
    fill: var(--color-muted-foreground);
    font-size: 11px;
  }
  .help svg .aa {
    font-family: var(--font-sequence, ui-monospace);
    font-size: 18px;
    font-weight: 600;
  }
  .help svg .box,
  .help svg .step rect {
    fill: var(--color-muted);
    stroke: var(--color-border);
  }
  .help svg .step.hl rect {
    stroke: var(--color-primary);
    stroke-width: 2;
  }
  .help svg .cut {
    stroke: var(--color-muted-foreground);
    stroke-dasharray: 3 3;
  }
  .help svg .axis {
    stroke: var(--color-muted-foreground);
  }
  .help svg .arrow {
    fill: none;
    stroke: var(--color-muted-foreground);
    stroke-width: 1.5;
  }
  .help .settings > div {
    border-top: 1px solid var(--color-border);
    padding: 0.5rem 0;
  }
  .help dt {
    font-weight: 600;
  }
  .help .tip {
    color: var(--color-muted-foreground);
  }
</style>
