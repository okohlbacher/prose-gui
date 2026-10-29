<script lang="ts">
  // Help › Videos and links: introductions by others, the ProSE sites and resources, and where the work goes on
  // after an identification. Links open in the system's browser.
  import { openUrl } from '$lib/desktop'

  const link = (url: string) => (e: MouseEvent) => {
    e.preventDefault()
    void openUrl(url)
  }

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
    { url: 'https://proteowizard.sourceforge.io/', title: 'ProteoWizard', note: 'msconvert, for converting vendor files to mzML' },
  ]
</script>

<section id="learn" aria-labelledby="learn-h">
  <h2 id="learn-h">Videos and links</h2>
  <p class="text-muted-foreground">These open in your browser. The videos are by others, chosen as introductions; ProSE is not affiliated with them.</p>
  <h3>Videos</h3>
  <ul class="prose-list">
    {#each videos as v (v.id)}
      <li><a href="https://www.youtube.com/watch?v={v.id}" onclick={link(`https://www.youtube.com/watch?v=${v.id}`)}>{v.title}</a> <span class="text-muted-foreground">· {v.by}</span></li>
    {/each}
  </ul>
  <h3>ProSE and resources</h3>
  <ul class="prose-list">
    {#each resources as r (r.url)}
      <li><a href={r.url} onclick={link(r.url)}>{r.title}</a> <span class="text-muted-foreground">· {r.note}</span></li>
    {/each}
  </ul>
</section>

<section id="learn-next" aria-labelledby="learn-next-h">
  <h2 id="learn-next-h">Where identification ends</h2>
  <p>
    ProSE identifies peptides and proteins from DDA (data-dependent acquisition) spectra. Other kinds of data go directly to
    their own tools: DIA (data-independent) data to a DIA search engine such as DIA-NN or OpenSWATH, targeted (SRM, PRM) data to
    Skyline, vendor files that the app cannot read to ProteoWizard msconvert first. After the identification come other tools:
    for label-free quantification OpenMS ProteomicsLFQ or quantms, for TMT and iTRAQ reporter ions OpenMS IsobaricAnalyzer, for
    the statistics of a comparison MSstats. Results › Export saves what they need from prose-gui: the identifications (idXML),
    the design (design.tsv) and an SDRF with the search’s settings. Check the sample and label assignments in the tool you use.
  </p>
</section>
