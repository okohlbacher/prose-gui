<script lang="ts">
  // The step of New search a card is (1 Spectra, 2 Protein database, 3 Search settings, 4 Rescoring), so that a
  // first-time user sees the order at a glance. Decoration only: the card's title stays its accessible name.
  let { n }: { n: number } = $props()
</script>

<span
  aria-hidden="true"
  class="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary tabular-nums"
  >{n}</span>
