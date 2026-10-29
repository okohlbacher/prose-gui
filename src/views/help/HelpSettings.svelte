<script lang="ts">
  // Help › The settings: what to set first, the built-in presets, every setting behind the "?" of New search
  // (`settings/help.ts`, ids "help-<key>"), the database summary and the SDRF.
  import { HELP, type HelpKey } from '$lib/settings/help'
  import { BUILTIN_PRESETS } from '$lib/settings/presets'

  const settings: HelpKey[] = [
    'setup',
    'database',
    'contaminants',
    'decoys',
    'variableMods',
    'fixedMods',
    'psmFdr',
    'proteinFdr',
    'enzyme',
    'missedCleavages',
    'precursorTolerance',
    'fragmentTolerance',
    'calibration',
    'charges',
    'length',
  ]

  /** When to use each built-in preset (`presets.ts`); the windows are read from the preset itself. */
  const USE: Record<string, string> = {
    'orbitrap-hcd-tryptic': 'Q Exactive, Exploris, Fusion, Lumos or Eclipse, with HCD fragments measured in the Orbitrap.',
    'astral-tryptic': 'Orbitrap Astral, fragments measured in the Astral analyzer.',
    'iontrap-cid-tryptic': 'High-resolution MS1 with fragments measured in an ion trap (a hybrid recording MS2 in its ion trap); a lower identification rate is expected. For a stand-alone ion trap (LTQ, Velos), set the precursor tolerance in Da as well.',
    'timstof-tryptic': 'Bruker timsTOF, ddaPASEF.',
    'open-search': 'To discover unexpected mass shifts on one file, with high-resolution MS2; not for routine searches.',
  }
  const windows = (p: Record<string, unknown>) => {
    const unit = (u: unknown) => (u === 'Da' ? ' Da' : ' ppm')
    return `precursor ±${p['precursor:mass_tolerance_upper']}${unit(p['precursor:mass_tolerance_unit'])}, fragments ${p['fragment:mass_tolerance']}${unit(p['fragment:mass_tolerance_unit'])}`
  }
</script>

<section id="settings" aria-labelledby="settings-h">
  <h2 id="settings-h">The settings</h2>
  <p>
    Start with the <b>preset</b> of your instrument and the <b>database</b> of your organism. Then match the <b>fixed
    modifications</b> (alkylation, labels) and the <b>enzyme</b> to your protocol: the built-in presets assume a tryptic digest and
    cysteines alkylated with iodoacetamide. Add only the <b>variable modifications</b> your sample needs. The instrument-dependent
    rest comes from the preset and is under “Advanced settings”; every parameter of ProSE is in the “All parameters” dialog. The
    same explanations are behind the <span aria-hidden="true">?</span> beside each setting.
  </p>

  <h3 id="help-presets">The built-in presets</h3>
  <ul class="prose-list">
    {#each BUILTIN_PRESETS as p (p.id)}
      <li><b>{p.name}</b>: {USE[p.id] ?? ''} <span class="text-muted-foreground">({windows(p.parameters)})</span></li>
    {/each}
  </ul>
  <p>
    There is no preset for SCIEX or other QTOF instruments: start from “Orbitrap HCD · tryptic”, set the windows to about 20–30 ppm
    for both precursor and fragments, check Overview › Mass accuracy after the first search, and save the result with “Save as
    preset”.
  </p>

  <dl class="settings mt-3">
    {#each settings as key (key)}
      <div id="help-{key}">
        <dt>{HELP[key].title}</dt>
        <dd>{HELP[key].text}{#if 'tip' in HELP[key]}<span class="tip">{' '}{HELP[key].tip}</span>{/if}</dd>
      </div>
    {/each}
  </dl>
</section>

<section id="help-database-summary" aria-labelledby="help-database-summary-h">
  <h2 id="help-database-summary-h">The database summary</h2>
  <p>
    When you choose a FASTA, the database card says in one line what it holds, for example “Homo sapiens (20,401 of 20,420
    entries) · UniProt headers · 1,532 isoforms · 116 contaminants · no decoys”: the main organism (from the OS= of the headers)
    and how many entries are of it, how many organisms there are in all, whether the headers are in UniProt style (accession,
    gene and organism can then be read), isoforms, contaminants, and decoys with their marker (e.g. rev_). Use it to check that
    the database is the one you meant: the right organism, complete, with or without decoys. A FASTA without OS= in its headers
    shows “no organism in the headers”, and the app cannot then compare it with the SDRF’s organism.
  </p>
</section>

<section id="help-sdrf" aria-labelledby="help-sdrf-h">
  <h2 id="help-sdrf-h">SDRF files</h2>
  <p>
    An SDRF (Sample and Data Relationship Format) file is a table that describes an experiment: its samples, their organism,
    the data files, labels, modifications and the design (fractions, replicates, conditions). Loaded in New search, it fills the
    design table and finds the data files (“Locate folder…” for those not found). The app then compares it with the search: the
    modifications and labels it lists against the chosen ones, and its organism against the database. It does not set the
    search chemistry for you; when it warns, either add what it lists or correct the SDRF.
  </p>
</section>
