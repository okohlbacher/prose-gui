<script lang="ts">
  // The ion table (mockup 3): per residue the theoretical m/z of the N-terminal ions of its number
  // (left of the residue) and of the C-terminal ions counted from the other end (right of it), for the
  // series and charges shown; matched ions marked by a tint of their series' colour, bold, and for
  // screen readers in words. A real table: it is the spectrum's table view too.
  import { modTitle, type PeptideView } from '$lib/format/peptide'
  import type { IonTable } from '$lib/psm/psm'

  // `hover`: the m/z under the pointer or focus, shared with the spectrum (a matched cell highlights its peak, a
  // peak its cell; survey P0-5). Matched cells take the focus, so the keyboard reaches every matched ion.
  let { table, peptide, label, hover = $bindable(null) }: { table: IonTable; peptide: PeptideView; label: string; hover?: number | null } = $props()
  const near = (mz: number) => hover !== null && Math.abs(mz - hover) < 0.05
  const enter = (cell: { mz: number; matched: boolean } | null) => {
    if (cell?.matched) hover = cell.mz
  }

  const n = $derived(peptide.residues.length)

  function cellClass(type: string, matched: boolean): string {
    if (!matched) return 'text-muted-foreground'
    return type === 'b' ? 'matched mb' : type === 'y' ? 'matched my' : 'matched mo'
  }
</script>

<div class="overflow-x-auto">
  <table class="ions w-full border-separate border-spacing-0 text-xs tabular-nums" data-testid="ion-table">
    <caption class="sr-only">Fragment ions of {label}: theoretical m/z, the matched ones marked</caption>
    <thead>
      <tr>
        <th scope="col" class="text-muted-foreground">#</th>
        {#each table.n as col (col.header)}<th scope="col" aria-label={col.header}>{col.type}<sup>{col.charge === 1 ? '+' : `${col.charge}+`}</sup></th>{/each}
        <th scope="col" class="text-center">AA</th>
        {#each table.c as col (col.header)}<th scope="col" aria-label={col.header}>{col.type}<sup>{col.charge === 1 ? '+' : `${col.charge}+`}</sup></th>{/each}
        <th scope="col" class="text-muted-foreground">#</th>
      </tr>
    </thead>
    <tbody>
      {#each table.rows as row (row.index)}
        {@const r = peptide.residues[row.index]}
        <tr>
          <td class="text-muted-foreground">{row.index + 1}</td>
          {#each row.n as cell, j (j)}
            <td
              data-type={table.n[j].type}
              data-ion={cell?.ion}
              data-matched={cell ? String(cell.matched) : undefined}
              class="{cell ? cellClass(table.n[j].type, cell.matched) : ''} {cell && near(cell.mz) ? 'hl' : ''}"
              tabindex={cell?.matched ? 0 : undefined}
              onmouseenter={() => enter(cell)}
              onfocus={() => enter(cell)}
              onmouseleave={() => (hover = null)}
              onblur={() => (hover = null)}
              >{#if cell}{cell.mz.toFixed(4)}{#if cell.matched}<span class="sr-only"> matched</span>{/if}{/if}</td>
          {/each}
          <th scope="row" class="aa" title={r.mod ? modTitle(r.mod) : undefined}
            >{#if r.mod}<span class="m">{r.residue}<sup>{r.mod.label}</sup></span>{:else}{r.residue}{/if}</th>
          {#each row.c as cell, j (j)}
            <td
              data-type={table.c[j].type}
              data-ion={cell?.ion}
              data-matched={cell ? String(cell.matched) : undefined}
              class="{cell ? cellClass(table.c[j].type, cell.matched) : ''} {cell && near(cell.mz) ? 'hl' : ''}"
              tabindex={cell?.matched ? 0 : undefined}
              onmouseenter={() => enter(cell)}
              onfocus={() => enter(cell)}
              onmouseleave={() => (hover = null)}
              onblur={() => (hover = null)}
              >{#if cell}{cell.mz.toFixed(4)}{#if cell.matched}<span class="sr-only"> matched</span>{/if}{/if}</td>
          {/each}
          <td class="text-muted-foreground">{n - row.index}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .ions th,
  .ions td {
    padding: 3px 7px;
    text-align: right;
    white-space: nowrap;
    border-bottom: 1px solid var(--color-border);
  }
  .ions thead th {
    font-weight: 500;
    color: var(--color-muted-foreground);
  }
  .ions thead sup {
    font-size: 9px;
    margin-left: 1px;
  }
  .ions .aa {
    text-align: center;
    font-weight: 600;
    font-family: var(--font-sequence);
  }
  .hl {
    outline: 2px solid var(--color-ring);
    outline-offset: -2px;
  }
  .matched {
    font-weight: 600;
  }
  /* matched: a tint of the series' colour, the text darker for contrast (b, y, other series) */
  .mb {
    color: var(--ion-b-fg);
    background: var(--ion-b-bg);
  }
  .my {
    color: var(--ion-y-fg);
    background: var(--ion-y-bg);
  }
  .mo {
    color: var(--ion-other-fg);
    background: var(--ion-other-bg);
  }
  .m {
    background: var(--mod-bg);
    color: var(--mod-fg);
    border-radius: 3px;
    padding: 0 1px;
    box-shadow: inset 0 -1.5px 0 var(--mod);
  }
  .m sup {
    font-family: 'Inter Variable', ui-sans-serif, system-ui, sans-serif;
    font-size: 9px;
    font-weight: 600;
    line-height: 0;
    margin-left: 1px;
  }
</style>
