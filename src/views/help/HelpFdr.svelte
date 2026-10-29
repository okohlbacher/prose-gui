<script lang="ts">
  // Help › Decoys and the FDR: the target-decoy idea (a drawing, and a cutoff to drag), the levels of the FDR, what
  // it is computed over, and when there is none.
  import FdrExplorer from '$lib/components/help/FdrExplorer.svelte'

  const b = 'var(--color-blue-600, #2563eb)'
  const y = 'var(--color-orange-500, #f97316)'
</script>

<section id="fdr" aria-labelledby="fdr-h">
  <h2 id="fdr-h">Decoys and the false discovery rate</h2>
  <p>
    Almost every searched spectrum gets a best-scoring candidate, even a spectrum of noise or of a peptide that is not in the
    database. To tell how many of the matches are wrong, ProSE also searches <em>decoys</em>: artificial sequences (the proteins
    reversed or shuffled) built to model wrong matches. The method assumes that a wrong match is about as likely to land on a
    decoy as on a real (target) sequence, so the decoys above a score cutoff estimate the wrong targets above it.
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
    <figcaption>
      FDR above the cutoff ≈ decoy matches ÷ target matches above it (ProSE adds one to the decoys, so a short list cannot reach a
      low FDR). ProSE chooses the cutoff that gives the FDR you set (e.g. 1 %).
    </figcaption>
  </figure>

  <h3 id="fdr-explore">Try it: move the cutoff</h3>
  <FdrExplorer />

  <ul class="prose-list">
    <li>
      The <b>PSM FDR</b> controls the matches: at 1 %, about one in a hundred reported PSMs is expected to be wrong. It is an
      estimate for the list of each file, not a property of a single PSM.
    </li>
    <li>Each PSM has a <b>q-value</b>: the lowest FDR at which it would still be reported.</li>
    <li>
      The <b>protein FDR</b> is estimated separately (picked-protein FDR). Wrong PSMs scatter over many proteins, so a protein list
      filtered at 1 % PSM FDR can contain far more than 1 % wrong proteins. Keep the protein FDR on for protein lists. When it is
      off, the app says so.
    </li>
    <li>Counts of peptides are not FDR-controlled at the peptide level; they come from the PSMs at the PSM FDR.</li>
    <li>
      A subset you select afterwards (the modified peptides, the proteins with one peptide) is not controlled separately: its
      share of wrong matches can be much higher than the list's.
    </li>
    <li>
      When the PSM FDR was applied, only PSMs that pass it are kept. A stricter cutoff in the results filters them further; to see
      matches below the original cutoff, search again with a higher FDR.
    </li>
  </ul>

  <h3 id="fdr-scope">What the FDR is computed over</h3>
  <p>
    ProSE estimates the PSM FDR per input file, separately for the PSMs scored with different numbers of fragment charges
    (FDR:PSM_groups), and the protein FDR once over all files of the search. The line under the design table of New search says
    this for your search. So search the files of one experiment (its fractions and replicates) together: separate searches each
    control only their own protein list, and putting their lists together does not keep the 1 %. Fractions are parts of one
    sample, not replicates; a design with one replicate per condition gives a comparison of the conditions nothing to rest on.
  </p>

  <h3 id="fdr-none">When there is no FDR</h3>
  <p>
    A search with Decoys set to “None (no FDR)” has no FDR at all, and a file in which no PSM matched a decoy has its PSM FDR not
    applied (“no FDR” in Overview › Files). Their PSMs are not FDR-controlled: do not report them as such. With very few PSMs (a
    few hundred) the estimate is coarse, because each decoy weighs much.
  </p>
</section>
