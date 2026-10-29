<script lang="ts">
  // The key figures above the tables: what the search found at its own cutoffs.
  import { formatPercent } from '$lib/format/fdr'
  import { formatCount } from '$lib/results/display'
  import { PSM_FDR_SKIPPED_WHY } from '$lib/results/overview'
  import type { KeyFigures } from '$lib/results/figures'

  let {
    figures,
    proteinFdr,
    proteinFdrApplied,
    psmFdr,
  }: { figures: KeyFigures; proteinFdr: number; proteinFdrApplied: boolean; psmFdr: number } = $props()

  // the FDR that controls each count, said on the tile and not only in its tooltip (survey P0-1)
  const psmScope = $derived(`at ${formatPercent(psmFdr)} PSM FDR`)

  // proteins that cannot be told apart count once here, but each has a row in the Proteins tab
  const groupTitle = $derived.by(() => {
    const { proteins, proteinGroups } = figures
    const base = `Target protein groups at the protein FDR, contaminants included. Proteins that share all their identified peptides cannot be told apart. They form one group and count once here. The Proteins tab lists every protein.`
    if (proteins === proteinGroups) return `${base} In this search every protein is its own group, so ${formatCount(proteins)} proteins make ${formatCount(proteinGroups)} groups.`
    return `${base} In this search, ${formatCount(proteins)} proteins form ${formatCount(proteinGroups)} groups.`
  })
  // the share of the MS2 spectra that are identified: spectra, not PSMs (with co-isolated precursors a spectrum
  // can have several PSMs)
  const share = $derived(figures.identifiedShareOfMs2 === null ? null : `${(figures.identifiedShareOfMs2 * 100).toFixed(0)} % of MS2`)
  const severalPerSpectrum = $derived(figures.spectra !== figures.psms)
  // PSMs of files whose PSM FDR was skipped (no decoy PSM): no q-value, not FDR-controlled
  const noFdr = $derived(figures.psms > 0 && figures.psmsWithoutFdr === figures.psms)
  const someWithoutFdr = $derived(figures.psmsWithoutFdr > 0 && !noFdr)
  const fdrNote = $derived(noFdr ? 'no PSM FDR' : someWithoutFdr ? `${formatCount(figures.psmsWithoutFdr)} without FDR` : null)
  const fdrTitle = $derived(
    noFdr
      ? figures.fdrOff
        ? ' The search had no decoys, so no FDR was applied: the PSMs have no q-value and are not FDR-controlled.'
        : ` The PSM FDR was not applied, so the PSMs have no q-value and are not FDR-controlled. ${PSM_FDR_SKIPPED_WHY}`
      : someWithoutFdr
        ? ` ${formatCount(figures.psmsWithoutFdr)} of them have no q-value: the PSM FDR was not applied to their files, so they are not FDR-controlled. ${PSM_FDR_SKIPPED_WHY}`
        : '',
  )
  const stats = $derived([
    {
      value: formatCount(figures.proteinGroups),
      // (the Proteins tab counts proteins: where groups join some, both numbers)
      note: [
        'protein groups',
        figures.proteins !== figures.proteinGroups ? `${formatCount(figures.proteins)} proteins` : null,
        proteinFdrApplied ? `${formatPercent(proteinFdr)} FDR` : 'no protein FDR',
      ]
        .filter(Boolean)
        .join(' · '),
      title: groupTitle,
      testid: 'protein-count',
    },
    {
      value: formatCount(figures.peptides),
      note: noFdr ? 'peptides · no PSM FDR' : `peptides · ${psmScope} · no peptide FDR`,
      title: `Target peptides of the PSMs at the PSM FDR. Each modified form counts as its own peptide. No peptide-level FDR was estimated, so the peptide FDR can be higher than the PSM FDR.${noFdr ? fdrTitle : ''}`,
      testid: 'peptide-count',
    },
    {
      value: formatCount(figures.psms),
      note: ['PSMs', fdrNote ?? psmScope, severalPerSpectrum ? `${formatCount(figures.spectra)} spectra` : null, share].filter(Boolean).join(' · '),
      title:
        (severalPerSpectrum
          ? `Target PSMs at the PSM FDR. They identify ${formatCount(figures.spectra)} of the ${formatCount(figures.ms2)} MS2 spectra: with co-isolated precursors a spectrum can have several PSMs.`
          : `Target PSMs at the PSM FDR, out of ${formatCount(figures.ms2)} MS2 spectra.`) + fdrTitle,
      testid: 'psm-count',
    },
    {
      value: formatCount(figures.samples),
      note: `${figures.samples === 1 ? 'sample' : 'samples'}${figures.conditions > 0 ? ` · ${figures.conditions} ${figures.conditions === 1 ? 'condition' : 'conditions'}` : ''}`,
      title: 'Biological samples in the design. Each condition and replicate is one sample.',
      testid: 'sample-count',
    },
    {
      value: figures.medianAbsPpm === null ? '–' : `${figures.medianAbsPpm.toFixed(1)} ppm`,
      note: 'median |precursor error|',
      title: 'Median absolute precursor mass error of the target PSMs at the PSM FDR',
      testid: 'precursor-error',
    },
  ])
</script>

<!-- one strip with dividers, not five cards -->
<div class="grid grid-cols-5 divide-x rounded-lg border">
  {#each stats as s (s.testid)}
    <div class="min-w-0 px-3.5 py-2" title={s.title}>
      <div class="text-lg leading-tight font-semibold tracking-tight tabular-nums" data-testid={s.testid}>{s.value}</div>
      <!-- wraps, never cut off: the note says which FDR controls the count (an ellipsis would hide "no peptide FDR") -->
      <div class="text-xs text-balance text-muted-foreground">{s.note}</div>
    </div>
  {/each}
</div>
