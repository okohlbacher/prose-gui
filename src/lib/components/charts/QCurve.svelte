<script lang="ts">
  // Identifications against the q-value cutoff: one line for PSMs, one for peptides, a marker at the search's FDR.
  import { formatCount } from '$lib/results/display'

  let {
    q,
    series,
    cutoff,
    title,
    description,
  }: { q: number[]; series: { name: string; color: string; counts: number[]; dashed?: boolean }[]; cutoff: number; title: string; description: string } = $props()

  const W = 560
  const H = 220
  const M = { left: 52, right: 16, top: 12, bottom: 34 }
  const max = $derived(Math.max(1, ...series.flatMap((s) => s.counts)))
  const x = (v: number) => M.left + (v / (q.at(-1) || 1)) * (W - M.left - M.right)
  const y = $derived((v: number) => H - M.bottom - (v / max) * (H - M.top - M.bottom))
  const path = (counts: number[]) => counts.map((c, i) => `${i === 0 ? 'M' : 'L'}${x(q[i]).toFixed(1)} ${y(c).toFixed(1)}`).join(' ')
  const pct = (v: number) => `${Number((v * 100).toPrecision(3))} %`
  const xTicks = $derived([0, 0.25, 0.5, 0.75, 1].map((f) => f * (q.at(-1) ?? 0)))
  const yTicks = $derived([0, 0.5, 1].map((f) => Math.round(f * max)))
</script>

<svg viewBox="0 0 {W} {H}" class="h-auto w-full" role="img" aria-label={title} font-size="11">
  <desc>{description}</desc>
  {#each yTicks as t, i (i)}
    <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--plot-band, #e5e7eb)" />
    <text x={M.left - 6} y={y(t) + 3.5} text-anchor="end" fill="var(--plot-muted, #6b7280)">{formatCount(t)}</text>
  {/each}
  {#each xTicks as t, i (i)}
    <text x={x(t)} y={H - M.bottom + 15} text-anchor="middle" fill="var(--plot-muted, #6b7280)">{pct(t)}</text>
  {/each}
  <text x={(M.left + W - M.right) / 2} y={H - 4} text-anchor="middle" fill="var(--plot-muted, #6b7280)">q-value cutoff</text>
  {#each series as s (s.name)}
    <path d={path(s.counts)} fill="none" stroke={s.color} stroke-width="2" stroke-dasharray={s.dashed ? '5 3' : undefined} />
  {/each}
  <line x1={x(cutoff)} x2={x(cutoff)} y1={M.top} y2={H - M.bottom} stroke="var(--plot-ink, #111)" stroke-dasharray="3 3" />
  <text x={x(cutoff) - 4} y={M.top + 10} text-anchor="end" fill="var(--plot-ink, #111)">search FDR {pct(cutoff)}</text>
</svg>
