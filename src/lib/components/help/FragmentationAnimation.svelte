<script lang="ts">
  // Help animation: a peptide ion breaks at one backbone bond after another; the part with the N-terminus is a b ion,
  // the part with the C-terminus a y ion, and each lands at its m/z in the spectrum below. Masses are the real
  // singly charged b and y ions of PEPTIDEK.
  import Player from './Player.svelte'

  const SEQ = 'PEPTIDEK'
  // monoisotopic residue masses (Da)
  const MASS: Record<string, number> = { P: 97.05276, E: 129.04259, T: 101.04768, I: 113.08406, D: 115.02694, K: 128.09496 }
  const PROTON = 1.007276
  const WATER = 18.010565
  const total = [...SEQ].reduce((s, a) => s + MASS[a], 0)
  const prefix = (i: number) => [...SEQ.slice(0, i)].reduce((s, a) => s + MASS[a], 0)
  /** b_i and y_(n-i) of the break after residue i (1-based). */
  const ions = Array.from({ length: SEQ.length - 1 }, (_, k) => {
    const i = k + 1
    return { i, b: prefix(i) + PROTON, y: total - prefix(i) + WATER + PROTON }
  })
  const lo = 0
  const hi = 1000
  const x = (mz: number) => 40 + ((mz - lo) / (hi - lo)) * 560

  let step = $state(0)
  const cut = $derived(ions[step])
  const b = 'var(--color-blue-600, #2563eb)'
  const y = 'var(--color-orange-500, #f97316)'
  // the ions shown so far (the spectrum fills up as the bonds break)
  const seen = $derived(ions.slice(0, step + 1))
</script>

<figure>
  <svg viewBox="0 0 640 230" role="img" aria-labelledby="frag-t" aria-describedby="frag-d">
    <title id="frag-t">A peptide breaks into b and y ions</title>
    <desc id="frag-d">PEPTIDEK breaks after residue {cut.i}: b{cut.i} at m/z {cut.b.toFixed(2)} and y{SEQ.length - cut.i} at m/z {cut.y.toFixed(2)}.</desc>
    {#each [...SEQ] as aa, k (k)}
      {@const left = k < cut.i}
      <g class="res" style:transform="translateX({left ? -14 : 14}px)">
        <rect x={110 + k * 54} y="22" width="42" height="36" rx="8" fill={left ? b : y} fill-opacity="0.18" stroke={left ? b : y} />
        <text x={131 + k * 54} y="46" text-anchor="middle" class="aa">{aa}</text>
      </g>
    {/each}
    <text x={110 + (cut.i * 54) / 2 - 14} y="76" text-anchor="middle" font-size="12" fill={b}>b{cut.i}</text>
    <text x={110 + cut.i * 54 + ((SEQ.length - cut.i) * 54) / 2 + 14} y="76" text-anchor="middle" font-size="12" fill={y}>y{SEQ.length - cut.i}</text>
    <!-- the spectrum -->
    <line x1="40" x2="600" y1="200" y2="200" class="axis" />
    {#each seen as s (s.i)}
      {@const now = s.i === cut.i}
      <line x1={x(s.b)} x2={x(s.b)} y1="200" y2={now ? 110 : 140} stroke={b} stroke-width={now ? 4 : 3} stroke-linecap="round" class="stick" />
      <line x1={x(s.y)} x2={x(s.y)} y1="200" y2={now ? 110 : 150} stroke={y} stroke-width={now ? 4 : 3} stroke-linecap="round" class="stick" />
      {#if now}
        <text x={x(s.b)} y="104" text-anchor="middle" font-size="11" fill={b}>b{s.i} {s.b.toFixed(1)}</text>
        <text x={x(s.y)} y="104" text-anchor="middle" font-size="11" fill={y}>y{SEQ.length - s.i} {s.y.toFixed(1)}</text>
      {/if}
    {/each}
    {#each [0, 250, 500, 750, 1000] as t (t)}
      <text x={x(t)} y="216" text-anchor="middle" class="sub">{t}</text>
    {/each}
    <text x="600" y="228" text-anchor="end" class="sub">m/z</text>
  </svg>
  <Player bind:step steps={ions.length} label="Fragmentation" />
  <figcaption>
    Each break gives a b ion (blue, the start of the peptide) and a y ion (orange, the end). Their m/z values are what the
    MS2 spectrum shows; the masses of b and y of one break add up to the peptide's mass plus two protons.
  </figcaption>
</figure>

<style>
  .res {
    transition: transform 0.6s ease;
  }
  .stick {
    transition: all 0.4s ease;
  }
  @media (prefers-reduced-motion: reduce) {
    .res,
    .stick {
      transition: none;
    }
  }
</style>
