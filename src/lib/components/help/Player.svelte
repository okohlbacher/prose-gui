<script lang="ts">
  // The controls of a Help animation: play/pause, a step back and forward, and where it is. The animation runs only
  // while it plays; with reduced motion asked for by the system it starts paused (each step still shows its frame).
  import { onMount } from 'svelte'

  let {
    step = $bindable(0),
    steps,
    interval = 1600,
    label,
  }: { step?: number; steps: number; interval?: number; label: string } = $props()

  let playing = $state(false)
  onMount(() => {
    playing = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  })
  $effect(() => {
    if (!playing) return
    const t = setInterval(() => (step = (step + 1) % steps), interval)
    return () => clearInterval(t)
  })
  const btn = 'h-7 rounded-md border bg-background px-2 text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
</script>

<div class="mt-2 flex items-center gap-1.5" role="group" aria-label="{label}: animation controls">
  <button type="button" class={btn} aria-pressed={playing} onclick={() => (playing = !playing)}>{playing ? 'Pause' : 'Play'}</button>
  <button type="button" class={btn} aria-label="Previous step" onclick={() => ((playing = false), (step = (step + steps - 1) % steps))}>‹</button>
  <button type="button" class={btn} aria-label="Next step" onclick={() => ((playing = false), (step = (step + 1) % steps))}>›</button>
  <!-- announced only while paused: a playing animation would announce every step without end -->
  <span class="text-xs text-muted-foreground tabular-nums" aria-live={playing ? 'off' : 'polite'}>Step {step + 1} of {steps}</span>
</div>
