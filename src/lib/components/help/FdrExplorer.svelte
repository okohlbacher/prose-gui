<script lang="ts">
  // Help, interactive: the score histogram of a simulated search, targets and decoys, and a cutoff to drag. Above
  // the cutoff, (decoys + 1) ÷ targets estimates the FDR, as Percolator counts it (the +1 keeps a short list from
  // looking perfect); "1 % FDR" moves the cutoff to where that estimate first falls
  // to 1 %. The scores are drawn once from fixed seeds (wrong matches score like decoys; right ones higher).
  function rng(seed: number) {
    let s = seed
    return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296)
  }
  function normals(n: number, mean: number, sd: number, seed: number): number[] {
    const r = rng(seed)
    return Array.from({ length: n }, () => mean + sd * Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r()))
  }
  const decoys = normals(400, 2, 1, 7)
  const targets = [...normals(400, 2, 1, 11), ...normals(900, 5.2, 1.1, 13)]
  const LO = -1
  const HI = 9
  const BINS = 40
  const width = (HI - LO) / BINS
  const hist = (xs: number[]) => {
    const h = new Array(BINS).fill(0)
    for (const v of xs) h[Math.min(BINS - 1, Math.max(0, Math.floor((v - LO) / width)))]++
    return h
  }
  const ht = hist(targets)
  const hd = hist(decoys)
  const max = Math.max(...ht, ...hd)
  const x = (v: number) => 40 + ((v - LO) / (HI - LO)) * 560
  const above = (xs: number[], c: number) => xs.filter((v) => v >= c).length

  let cutoff = $state(3)
  const t = $derived(above(targets, cutoff))
  const d = $derived(above(decoys, cutoff))
  const estimate = (targetsAbove: number, decoysAbove: number) => (targetsAbove > 0 ? Math.min(1, (decoysAbove + 1) / targetsAbove) : 1)
  const fdr = $derived(estimate(t, d))
  function onePercent() {
    for (let c = LO; c <= HI; c += 0.01) {
      if (estimate(above(targets, c), above(decoys, c)) <= 0.01) {
        cutoff = Math.ceil(c * 100 - 1e-9) / 100 // (rounded up: a lower cutoff could pass 1 %)
        return
      }
    }
  }
</script>

<figure>
  <svg viewBox="0 0 640 220" role="img" aria-labelledby="fdr-t" aria-describedby="fdr-d">
    <title id="fdr-t">Target and decoy scores with a movable cutoff</title>
    <desc id="fdr-d">At the cutoff {cutoff.toFixed(2)}: {t} target and {d} decoy matches above it, estimated FDR {(fdr * 100).toFixed(1)} %.</desc>
    {#each ht as n, i (i)}
      <rect x={x(LO + i * width)} y={180 - (n / max) * 150} width={(560 / BINS) * 0.9} height={(n / max) * 150} fill="var(--color-blue-600, #2563eb)" opacity="0.45" />
    {/each}
    {#each hd as n, i (i)}
      <rect x={x(LO + i * width) + 2} y={180 - (n / max) * 150} width={(560 / BINS) * 0.9 - 4} height={(n / max) * 150} fill="var(--color-orange-500, #f97316)" opacity="0.75" />
    {/each}
    <line x1="40" x2="600" y1="180" y2="180" class="axis" />
    <line x1={x(cutoff)} x2={x(cutoff)} y1="20" y2="186" stroke="var(--color-foreground)" stroke-width="2" stroke-dasharray="4 3" />
    <text x={x(cutoff) + 6} y="30" class="sub">cutoff {cutoff.toFixed(2)}</text>
    <text x="40" y="200" class="sub">low score</text>
    <text x="600" y="200" text-anchor="end" class="sub">high score</text>
    <text x="300" y="214" text-anchor="middle" class="sub">blue: targets (right and wrong) · orange: decoys (all wrong)</text>
  </svg>
  <div class="mt-2 flex flex-wrap items-center gap-3 text-xs">
    <label class="flex items-center gap-2">Cutoff
      <input type="range" min={LO} max={HI} step="0.01" bind:value={cutoff} aria-label="Score cutoff" class="w-56 max-w-full" />
    </label>
    <button type="button" class="h-7 rounded-md border bg-background px-2 hover:bg-muted" onclick={onePercent}>Set to ≤ 1 % FDR</button>
    <span class="tabular-nums" aria-live="polite">above it: <b>{t}</b> targets · <b>{d}</b> decoys · {#if t > 0}estimated FDR ≈ (decoys + 1) ÷ targets = <b>{(fdr * 100).toFixed(1)} %</b>{:else}no targets: no FDR can be estimated{/if}</span>
  </div>
  <figcaption>
    Simulated scores. Wrong matches score like decoys, so the decoys above a cutoff estimate how many of the targets above it
    are wrong. This simulation uses Percolator's estimate, which adds one to the decoys so that a short list cannot claim
    no errors. A lower cutoff usually gives more identifications and a higher FDR, but the estimate jumps about for short
    lists: a high cutoff with few targets can show a higher FDR than a lower one. That is why a PSM's q-value is the lowest
    estimate of all the cutoffs that would still report it. ProSE picks the cutoff for the FDR you set.
  </figcaption>
</figure>
