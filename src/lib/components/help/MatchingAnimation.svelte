<script lang="ts">
  // Help animation (schematic): one measured MS2 spectrum, and the predicted b/y ions of three candidate peptides
  // whose mass fits the precursor, tried one after the other. Predicted ions that land on a measured peak (within
  // the fragment tolerance) count; the candidate that explains the most, and the most intense, peaks wins.
  import Player from './Player.svelte'

  // measured peaks (m/z, relative intensity); the true peptide explains the coloured ones
  const peaks = [
    [150, 0.35], [205, 0.2], [262, 0.7], [310, 0.15], [375, 0.55], [430, 0.3], [488, 0.9], [540, 0.12], [601, 0.6], [655, 0.25],
    [714, 0.8], [770, 0.18], [829, 0.45], [880, 0.1],
  ] as const
  const candidates = [
    { name: 'LQEVTSAK', ions: [180, 262, 345, 430, 520, 655, 800] },
    { name: 'TEPIDEPK', ions: [150, 240, 375, 470, 560, 690, 829] },
    { name: 'PEPTIDEK', ions: [150, 262, 375, 488, 601, 714, 829] },
  ]
  const TOL = 4
  const x = (mz: number) => 40 + ((mz - 100) / 850) * 560
  const matched = (c: (typeof candidates)[number]) => c.ions.filter((m) => peaks.some(([p]) => Math.abs(p - m) <= TOL))
  const score = (c: (typeof candidates)[number]) =>
    matched(c).reduce((s, m) => s + (peaks.find(([p]) => Math.abs(p - m) <= TOL)?.[1] ?? 0), 0)
  const best = Math.max(...candidates.map(score))

  let step = $state(0)
  // the last step shows the winner again, marked as the PSM
  const c = $derived(candidates[Math.min(step, candidates.length - 1)])
  const hits = $derived(new Set(matched(c)))
  const final = $derived(step === candidates.length)
</script>

<figure>
  <svg viewBox="0 0 640 250" role="img" aria-labelledby="match-t" aria-describedby="match-d">
    <title id="match-t">Candidates are compared with the measured spectrum</title>
    <desc id="match-d">Candidate {c.name}: {hits.size} of its {c.ions.length} predicted ions match a measured peak.</desc>
    <text x="40" y="16" class="sub">measured MS2 spectrum</text>
    <line x1="40" x2="600" y1="120" y2="120" class="axis" />
    {#each peaks as [mz, h] (mz)}
      {@const on = [...hits].some((m) => Math.abs(m - mz) <= TOL)}
      <line x1={x(mz)} x2={x(mz)} y1="120" y2={120 - h * 90} stroke-width="4" stroke-linecap="round"
        stroke={on ? 'var(--color-primary)' : 'var(--color-muted-foreground)'} opacity={on ? 1 : 0.45} class="peak" />
    {/each}
    {#each c.ions as mz (mz)}
      <line x1={x(mz)} x2={x(mz)} y1="124" y2="170" stroke-width="4" stroke-linecap="round" class="ion"
        stroke={hits.has(mz) ? 'var(--color-primary)' : 'var(--color-destructive, #dc2626)'} opacity={hits.has(mz) ? 0.9 : 0.5} />
    {/each}
    <text x="40" y="190" class="sub">predicted b/y ions of candidate</text>
    <text x="230" y="190" class="aa" font-size="15">{c.name}</text>
    <!-- the score -->
    <rect x="40" y="206" width="400" height="12" rx="6" class="track" />
    <rect x="40" y="206" width={(score(c) / best) * 400} height="12" rx="6" fill="var(--color-primary)" class="bar" />
    <text x="450" y="216" class="sub">{hits.size} of {c.ions.length} ions match{final ? ' · best: this is the PSM' : ''}</text>
  </svg>
  <Player bind:step steps={candidates.length + 1} interval={2000} label="Matching" />
  <figcaption>
    Schematic. ProSE takes every database peptide whose mass fits the precursor, predicts its fragment ions and counts
    those that line up with a measured peak. The best-scoring candidate becomes the spectrum's PSM, even when it is wrong,
    which is why the FDR is needed.
  </figcaption>
</figure>

<style>
  .peak,
  .ion,
  .bar {
    transition: all 0.5s ease;
  }
  .track {
    fill: var(--color-muted);
  }
  @media (prefers-reduced-motion: reduce) {
    .peak,
    .ion,
    .bar {
      transition: none;
    }
  }
</style>
